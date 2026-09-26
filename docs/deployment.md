# Deploying to a real URL

This is the Firebase App Hosting path: App Hosting builds the repository from
GitHub on every push to the branch you connect, and serves it on Cloud Run
behind a Google-managed domain and certificate.

Everything in this document that can be committed already is. What is left is
the handful of things only the account owner can do.

---

## Before you start

**The app root is the repository root.** `package.json`, `next.config.ts` and
`apphosting.yaml` are all at the top level. When the console asks for a root
directory, leave it as `/`. There is no subdirectory to point at, and a wrong
value here fails the build with "no package.json found".

**Pick a runtime for automatic base image updates.** Node 20 or newer; Node 24
is the right answer today. Leaving it unspecified opts you out of automatic
security patches to the operating system and Node itself, which is not a
trade worth making for a bill-keeping app.

**Leave the console's environment-variable form empty.** Configuration lives in
`apphosting.yaml`, where it is version-controlled, reviewable and deployed with
the code that reads it. A value that exists only in a console form is a value
nobody can find later.

---

## What you do not have to configure

Three things that normally need copying are handled:

- **The Firebase Web config** — API key, auth domain, project id, app id. App
  Hosting creates a Web App for the backend and hands the build
  `FIREBASE_WEBAPP_CONFIG`; `next.config.ts` maps it onto the `NEXT_PUBLIC_`
  names the browser reads. Anything you set explicitly still wins.
- **The server's project id** — read from `GOOGLE_CLOUD_PROJECT`, which Cloud
  Run sets.
- **Firebase credentials** — the backend runs as its own service account
  (`firebase-app-hosting-compute@…`) which already has Firebase access, and
  `firebase-admin` picks it up through Application Default Credentials.

  **Do not download a service account key.** The classic Admin SDK account
  (`firebase-adminsdk-…@…`) exists so that code running *outside* Google
  infrastructure can authenticate, and using it means creating a JSON private
  key that has to be stored somewhere, rotated by someone, and is a full
  credential to your entire database for as long as it exists. Nothing in this
  deployment needs one. If a Firestore call is ever refused with a permissions
  error, the fix is to grant the App Hosting service account the Firestore role
  in IAM — not to introduce a key.

---

## The sign-in page, and where its config comes from

The browser needs the Firebase Web config — API key, auth domain, project id,
app id — to sign anyone in. It is read **on the server at request time** and
handed to the page, rather than read by the browser itself.

That is deliberate. Next inlines `NEXT_PUBLIC_*` into the client bundle at
*build* time, so a host that supplies configuration only at *runtime* ships a
bundle containing four empty strings, and a sign-in page whose only behaviour
is to report that its config is missing. Reading it server-side works either
way, which is why `FIREBASE_WEBAPP_CONFIG` alone is enough and there is nothing
to set.

If sign-in ever does report a missing config, the server could not find one:
check that the backend has a Firebase Web App associated with it.

---

## 1. The worker secret

The background worker endpoint refuses every request that does not present a
shared secret, so without it the queue is never drained and monthly drafts are
never prepared.

It is **not** required for the first rollout. A backend that refuses to start
because a secret for a background job is missing is worse than one that bills
correctly while that job waits — so `apphosting.yaml` has it commented out, and
Business details reports *Monthly drafts: not configured* until you finish this.

```bash
openssl rand -hex 32                     # copy the output
firebase apphosting:secrets:set job-runner-secret --project ekbill
firebase apphosting:secrets:grantaccess job-runner-secret \
  --project ekbill --backend easybills
```

Then uncomment the `JOB_RUNNER_SECRET` block in `apphosting.yaml` and push.
Doing it the other way round — referencing the secret before it exists — fails
the rollout with *Error resolving secret version*, which is the same message
whether the secret is missing or merely inaccessible.

---

## 2. Deploy the database rules and indexes

App Hosting deploys the application. It does not touch Firestore, so this is a
separate, one-time command — and it is not optional:

```bash
firebase use production          # the alias in .firebaserc
firebase deploy --only firestore:rules,firestore:indexes
```

`firestore.rules` denies **all** direct client access. Every record is reached
through this app's own server, which is what makes tenant isolation a server
invariant rather than a rule that has to be got right. Deploying the rules is
what turns that from a claim into a fact.

`firestore.indexes.json` holds every compound query the app makes.
Without it the first real user gets `FAILED_PRECONDITION: The query requires an
index` on Home. The emulator answers unindexed queries happily, so nothing in
local development would have told you — which is why
`tests/unit/firestore-indexes.test.ts` checks the file against the queries
instead.

---

## 3. First rollout

Push to the connected branch. When the rollout finishes, the console shows the
backend's domain, and there is nothing to set afterwards: every link the app
produces is relative, so it is correct on that domain, on a preview URL and on
your own domain without being told which it is.

---

## 4. The background worker

Recurring monthly drafts are prepared by a job queue. Nothing drains it unless
something calls the runner, so a deployment without this silently stops
preparing drafts — the one failure an owner would not notice until a customer
asks where their bill is.

```bash
gcloud scheduler jobs create http easybills-worker \
  --location=asia-south1 \
  --schedule="0 * * * *" \
  --time-zone="Asia/Kolkata" \
  --uri="https://YOUR-BACKEND-DOMAIN/api/jobs/run" \
  --http-method=POST \
  --headers="Authorization=Bearer YOUR-JOB-RUNNER-SECRET"
```

Hourly is deliberate. The endpoint queues the daily sweep and drains what is
due, and does nothing else, so a scheduler that fires twice, late, or not at
all still converges on the right drafts.

---

## 5. The assistant, if you want it

The app is complete without it: the bill editor is the product and "speak or
type your bill" is a shortcut into it. Off is the default.

The API key never goes in `apphosting.yaml`, in the console, or in `.env`.

```bash
firebase apphosting:secrets:set ai-llm-api-key
firebase apphosting:secrets:grantaccess ai-llm-api-key --backend easybills
```

Then uncomment the assistant block in `apphosting.yaml` and set `AI_ENABLED` to
`"true"`. The key is read into the server process at boot and never reaches the
browser — every model call is made server-side.

Voice is a separate provider and a separate key. Leave it unset and the
microphone button stays hidden rather than failing when tapped.

---

## Bill PDFs

A bill's PDF is rendered by a real Chromium inside the container. No managed
Node host ships one, so `@sparticuz/chromium` is a dependency: a Chromium built
to run there, unpacked to `/tmp` on first use. It costs a few seconds on the
first PDF after a cold start and nothing after, which is why `apphosting.yaml`
asks for 1GiB of memory and a 120-second timeout rather than the defaults.

Two files this needs are invisible to Next's build-time file tracing — it
follows `import` and `require`, and misses both `playwright-core/browsers.json`
(read as data) and the browser archive under `@sparticuz/chromium/bin/` (nothing
imports it). `outputFileTracingIncludes` in `next.config.ts` copies both
packages whole. Removing that produces a server that starts cleanly, serves
every page, and then fails the moment a customer is sent their bill.

If you host somewhere you control the image, install a system Chromium and set
`PLAYWRIGHT_CHROMIUM_PATH`. It is faster, and an explicitly configured path
always wins over the bundled one.

**Business details reports whether this deployment can produce a PDF at all**,
under "App status". If it says anything other than *ready*, sharing a bill with
a customer will not work, and the page says so in as many words rather than
leaving it to be discovered at the download.

---

## What is still not ready for real money

Deploying does not make these go away. They are recorded in full in
[acceptance-report.md](acceptance-report.md) and
[compliance/README.md](compliance/README.md):

- **Every legal value in the GST rule pack ships `unverified`**, because the
  official CBIC and GST portal domains were unreachable from the build
  environment. Anything depending on one — e-invoicing thresholds, filing due
  dates, HSN digit requirements — is switched off or blocked rather than
  guessed. No GST return can be declared ready in this build. A practitioner
  has to confirm those values before the GST module is usable.
- **Connected filing is off** and needs a GSP contract.
- **No backup restore has been rehearsed.** Write the schedule down and test a
  restore before an owner depends on this for their books.
