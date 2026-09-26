# Deploying to a real URL

This is the Firebase App Hosting path: App Hosting builds the repository from
GitHub on every push to the branch you connect, and serves it on Cloud Run
behind a Google-managed domain and certificate.

Everything in this document that can be committed already is. What is left is
the handful of things only the account owner can do.

---

## Moving to a new Firebase project

The app is pointed at project **`ekbill-1918b`** (`apphosting.yaml`,
`.firebaserc`). A fresh project has nothing in it, so in this order:

1. **Firestore Database › Create database** — Native mode, `asia-south1`, the
   `(default)` database (see 2a below). Nothing works before this exists.
2. **App Hosting › Create backend** in the new project — connect the GitHub
   repo, branch `claude/admiring-wright-5w8x4g`, root directory `/`, region
   `asia-south1` if offered (the database is there). The first rollout starts
   on its own once the branch is connected.
3. From Cloud Shell, `firebase use production && firebase deploy --only firestore`
   (section 2) for the rules and the indexes.
4. Open `/api/health` on the new `*.hosted.app` address: it should say
   `"projectId":"ekbill-1918b"`, `"database":"(default)"`, `"firestore":"ok"`.

Sign-in stays switched off (`AUTH_BYPASS`) until the app itself is done, so
nothing under Authentication needs doing yet. The console's snippet also
offers Analytics; it is deliberately not used -- see the note in
`apphosting.yaml`.

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

## Sign-in is currently switched off

`apphosting.yaml` sets `AUTH_BYPASS: "true"`. With it on there is **no
sign-in**: everyone who opens the address is the same test user, and can read
every bill, issue new ones and record payments. The app says so in red at the
top of every screen, and Business details reports *Sign-in: switched off — open
access*.

It exists so the app can be looked at without setting up Firebase Auth first.
It must come off before a real business's books go in.

The test user gets its own demo business, seeded on first visit and flagged as
sample records, so nothing real is ever mixed into it.

**To turn sign-in back on**

1. Set `AUTH_BYPASS` to `"false"` in `apphosting.yaml` (or delete those three
   lines), commit and push.
2. In **Firebase Console › Authentication › Sign-in method**, enable
   **Phone**. Without it, sending an OTP raises
   `auth/configuration-not-found` — which the app reports, in words, as
   "Phone se login abhi chalu nahi hai".
3. In **Authentication › Settings › Authorized domains**, make sure the
   App Hosting domain (the `*.hosted.app` address shown on the backend) is listed. The
   invisible reCAPTCHA that guards the SMS refuses a domain that is not.

Nothing else changes: the bypass is a single branch in `currentUser()`, the one
question every page, server action and API route asks. Switching it off
restores the ordinary path exactly.

---

## Sign-in providers

The owner signs in with their phone: the number, then a 6-digit OTP by SMS.
There is no password, no email and no Google button. Nothing in this app can
switch a sign-in method on; that lives in the Firebase project. In
**Firebase Console › Authentication › Sign-in method**, enable:

- **Phone** — required. Without it every sign-in fails.

Switched off, it raises `auth/configuration-not-found`, which the sign-in page
translates into "Phone se login abhi chalu nahi hai. Jo app sambhalta hai,
usse kaho" rather than showing an owner a code they can do nothing with.

Two things to know about phone sign-in on Firebase:

- **The SMS costs money past the free allowance.** Firebase's no-cost tier
  covers a number of verifications a month; beyond that the project must be on
  the Blaze plan and each SMS is billed. For a business making 50 bills a year
  this is a few rupees a year, but it is a real bill and the project owner sees
  it.
- **The invisible reCAPTCHA** loads a script from google.com on the sign-in
  page only. It never shows anything unless Google is unsure a person is
  typing. There is no App Check in this app; add it in the Firebase console if
  SMS abuse ever becomes a cost.

For testing without spending SMS, add **test phone numbers** under
Authentication › Sign-in method › Phone › *Phone numbers for testing*: a
number and the OTP it will always accept. Those never send an SMS.

The app requires a password of at least 8 characters. That is this app's rule,
not Firebase's, which stops at 6.

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

## 0. Where to run these commands

The commands below need to see `firestore.rules` and `firestore.indexes.json`,
which are files in this repository. So they run in a terminal, from a checkout
of it — not in the Firebase Console.

### The easy way: Cloud Shell

**[console.cloud.google.com](https://console.cloud.google.com)** → the terminal
icon in the top bar (*Activate Cloud Shell*). It is a Linux terminal in the
browser that is **already signed in as you**, with `git` and Node already
installed. Nothing to install on your own computer, and no `firebase login`
browser dance.

```bash
npm install -g firebase-tools
git clone https://github.com/Ergplan/easybills.git
cd easybills
git checkout claude/admiring-wright-5w8x4g
firebase login --no-localhost     # prints a link; paste the code back
firebase use production           # the alias for ekbill-1918b, in .firebaserc
```

`--no-localhost` matters in Cloud Shell: the ordinary `firebase login` tries to
open a browser on the machine running it, and that machine is in a data centre.

### Or on your own computer

Same commands, with `firebase login` instead of `firebase login --no-localhost`,
and Node.js installed first from [nodejs.org](https://nodejs.org) if you do not
have it.

### If the repository is private

`git clone` will ask for credentials. In Cloud Shell the simplest route is a
GitHub personal access token as the password, or use the Console fallback for
the rules described in step 2.

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
openssl rand -hex 32
# Copy the 64-character output. You need it twice: once here, once in the
# scheduler in step 4. Keep it somewhere until then.

firebase apphosting:secrets:set job-runner-secret
# Paste the value when prompted. It is not echoed.

firebase apphosting:secrets:grantaccess job-runner-secret --backend easybills
```

Then uncomment the `JOB_RUNNER_SECRET` block in `apphosting.yaml`, commit and
push — pushing is what triggers the rollout that picks it up.

On Windows without `openssl`, any long random string works:
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
Doing it the other way round — referencing the secret before it exists — fails
the rollout with *Error resolving secret version*, which is the same message
whether the secret is missing or merely inaccessible.

---

## 2a. Create the database (this is not automatic)

Creating the Firebase project does **not** create a database. The app uses
**Cloud Firestore in Native mode**, the `(default)` database — not Realtime
Database, not a named database.

Firebase Console › **Firestore Database** › **Create database**:

- **Native mode**, not Datastore mode.
- **Location** `asia-south1` (Mumbai) for an Indian business. **This can never
  be changed.** Not renamed, not migrated, not edited — the only route to a
  different region is a different database.

  It is worth getting right, because every screen reads Firestore before it
  renders anything: Home reads bills and schedules, the list reads invoices,
  opening a bill reads that invoice, its payments and its adjustments. A
  database in `nam5` (United States) puts an ocean in front of each of those
  round trips, and the owner waits for it on every tap. Indian tax records also
  then sit outside India, which an accountant may have a view on.

  **Already created in the wrong region?** Nothing needs deleting. Create a
  *second* database in `asia-south1` with a name of its own, set
  `FIRESTORE_DATABASE_ID` in `apphosting.yaml` to that name, name it in the
  `firestore` block of `firebase.json` too, and push. Anything already in the
  old one has to be copied across by hand, which is why doing this while it is
  still empty costs nothing at all.
- Start in production mode; the rules deployed in the next step replace
  whatever you pick here anyway.

Skip this and every page returns a blank server error with a request id. The
reason it is blank rather than a message is worth knowing: an unreachable
Firestore does not fail, it retries, so the request hangs until Cloud Run gives
up. Nothing gets a chance to explain itself.

**Open `/api/health` on the deployed address first when anything is wrong.**
It answers in seconds and names the cause:

```json
{ "ok": false, "firestore": "FAILED",
  "firestoreError": { "code": "TIMEOUT", "hint": "…create one in Firebase Console…" } }
```

It reports state, never secrets — which project, whether Firestore answered,
whether a browser is available for PDFs — and is the first thing to try after a
bad rollout instead of Cloud Logging.

---

## 2. Deploy the database rules and indexes

App Hosting deploys the application. It does not touch Firestore, so this is a
separate, one-time command — and it is not optional:

```bash
firebase deploy --only firestore
```

There is no `--database` flag. The database is named in `firebase.json`;
this project uses the project's `(default)` database. If yours was created
with a name, put that name here and in `FIRESTORE_DATABASE_ID` in
`apphosting.yaml`:

```json
"firestore": [
  { "database": "(default)", "rules": "firestore.rules", "indexes": "firestore.indexes.json" }
]
```

Expect two things in the output: *firestore: released rules firestore.rules to
cloud.firestore*, and the indexes being created. Index builds are asynchronous
— the command returns before they finish, and Firestore Console › Indexes shows
each one as *Building* then *Enabled*. Queries against an index still building
fail exactly as they would if it were missing, so give it a minute on a small
database before deciding something is wrong.

### No terminal at all?

The **rules** can be pasted straight into Firebase Console › Firestore Database
› **Rules**, and published. That takes a minute and is the security-critical
half — with sign-in switched off, those rules are the only thing stopping
someone reading the database directly with the public API key. The whole file is
fifteen lines; copy it from `firestore.rules` in the repository.

The **indexes** are six composite indexes, each with its own field order, and
can be added by hand in Console › Firestore Database › Indexes › *Create index*
(collection ID, then the fields in this order, query scope *Collection*):

| Collection | Fields, in order |
|---|---|
| `invoices` | `status` ↑, `updatedAt` ↓ |
| `invoices` | `status` ↑, `issueDate` ↑ |
| `invoices` | `customer.customerId` ↑, `status` ↑ |
| `customers` | `archived` ↑, `lastBilledAt` ↓ |
| `jobs` | `status` ↑, `runAfter` ↑ |
| `gstStatementSnapshots` | `gstin` ↑, `period` ↑, `statementType` ↑, `importVersion` ↓ |

The order matters and a wrong one shows up as a query that fails in production,
so the command is the safer route if you have any way to run it.

`firestore.rules` denies **all** direct client access. Every record is reached
through this app's own server, which is what makes tenant isolation a server
invariant rather than a rule that has to be got right. Deploying the rules is
what turns that from a claim into a fact.

The rules deny **all** direct client access, and
`tests/integration/rules.test.ts` executes them with the client SDK to prove
it — signed out, signed in, and as one business reaching for another's records.
Every other test in the suite reaches Firestore through the Admin SDK, which
bypasses rules by design, so all of them would pass just as happily against a
rule set that allowed the world.

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
