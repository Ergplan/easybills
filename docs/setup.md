# Setup

## What you need

- Node.js 22 or newer
- Java 11+ (the Firestore emulator runs on the JVM; only needed for local development)
- A Firebase project (only when you move beyond the emulators)

## Local development

```bash
npm install
cp .env.example .env.local
```

The defaults in `.env.example` point at the local emulator suite, so the only
value you must change before running anything is the job runner secret:

```bash
# in .env.local
JOB_RUNNER_SECRET=$(openssl rand -hex 32)
```

Then, in three terminals:

```bash
npm run emulators   # Firebase Auth (9099) + Firestore (8080), UI on 4000
npm run dev         # http://localhost:3000
npm run worker      # optional: prepares monthly drafts every minute
```

The first emulator run downloads the Firestore emulator (about 130 MB) into
`~/.cache/firebase`.

Open http://localhost:3000, create an account with any email and password (the
Auth emulator accepts anything), name your business, and you can start a bill
immediately.

### Sample data

Sign up in the app first, copy your uid from the Auth emulator UI at
http://127.0.0.1:4000/auth, then:

```bash
npm run db:seed -- --uid <your-uid> --profile repair
```

`--profile` is one of `repair`, `consultant` or `home-food`. The `repair`
profile reproduces the brief's worked example: two visits at 800 plus parts of
450, subtotalling 2,050 before tax, part paid.

The CLI entry points (`db:seed`, `worker`, `gst:audit-rules`) run through
`tsconfig.scripts.json`, which loads `.env.local` and resolves the `server-only`
build guard to a no-op — that guard exists for the Next bundler, and plain Node
would otherwise refuse to import server modules at all. Each creates a
business flagged as a demo — the app labels it on every screen so sample records
can never be mistaken for real ones. Identities are obviously fictitious, and
their GSTINs are structurally valid but generated, not real registrations.

### PDFs

PDF rendering drives a real Chromium through `playwright-core`. If your machine
has no Playwright browsers:

```bash
npx playwright install chromium
```

Or point at a Chromium you already have:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome
```

## Tests

```bash
npm test          # 255 tests; integration tests need the emulators running
npm run typecheck
npm run e2e       # browser smoke test; needs `npm run dev` and the emulators
```

The integration tests refuse to run unless `FIRESTORE_EMULATOR_HOST` is set, so
a misconfigured CI job cannot write test data into a real project.

## Running against a real Firebase project

1. Create a Firebase project and enable **Authentication** (Email/Password, and
   Google if you want it) and **Cloud Firestore**.

2. Deploy the security rules. They deny all direct client access, which is the
   backstop for tenant isolation — the app reaches Firestore only through the
   Admin SDK, behind server-side membership checks.

   ```bash
   npx firebase deploy --only firestore:rules --project <your-project>
   ```

3. Put the Web config into `.env.local`. These values are public by design: they
   identify the project, they do not grant access.

   ```
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project
   NEXT_PUBLIC_FIREBASE_API_KEY=...
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_APP_ID=...
   FIREBASE_PROJECT_ID=your-project
   ```

4. Give the server credentials. Prefer Application Default Credentials
   (`GOOGLE_APPLICATION_CREDENTIALS`, or the metadata server on Google infra).
   A service-account JSON in `FIREBASE_SERVICE_ACCOUNT_JSON` also works.

5. **Remove the emulator variables.** While `FIRESTORE_EMULATOR_HOST` is set the
   app talks to the emulator and ignores real credentials entirely.

   ```
   # delete these three lines for anything other than local development
   FIRESTORE_EMULATOR_HOST=...
   FIREBASE_AUTH_EMULATOR_HOST=...
   NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=...
   ```

### Firestore indexes

The app uses a handful of composite queries. Firestore will tell you, with a
direct link, the first time one is missing. Alternatively run the app through
its main screens against an empty project and add the indexes it asks for. The
queries that need them are invoices by `status` + `issueDate`, invoices by
`customer.customerId` + `status`, and statement snapshots by `gstin` + `period`
+ `importVersion`.

## Deployment

Any host that runs a Node server works. The app needs the Node runtime (not
edge) because it uses the Firebase Admin SDK and drives Chromium for PDFs.

```bash
npm run build
npm start
```

Checklist before you serve real traffic:

- [ ] `JOB_RUNNER_SECRET` is a long random value, not the example
- [ ] Emulator variables are unset
- [ ] Firestore rules are deployed (they should deny everything)
- [ ] Application Default Credentials or a service account is configured
- [ ] `APP_BASE_URL` matches the real origin
- [ ] HTTPS is terminated in front of the app (session cookies are marked
      `secure` in production)
- [ ] Chromium is available to the server process, or `PLAYWRIGHT_CHROMIUM_PATH`
      points at one
- [ ] A scheduler calls the job endpoint (below)
- [ ] You have read [docs/acceptance-report.md](acceptance-report.md) and accept
      what is not yet verified

### Monthly drafts in production

Monthly drafts must not depend on anyone having the app open. Point a scheduler
at the job endpoint, hourly or daily:

```
POST https://your-app/api/jobs/run
Authorization: Bearer <JOB_RUNNER_SECRET>
```

Google Cloud Scheduler:

```bash
gcloud scheduler jobs create http easybills-jobs \
  --schedule="0 * * * *" \
  --time-zone="Asia/Kolkata" \
  --uri="https://your-app/api/jobs/run" \
  --http-method=POST \
  --headers="Authorization=Bearer ${JOB_RUNNER_SECRET}"
```

The endpoint is safe to call more often than needed and safe to miss: occurrence
ids are deterministic, so a double call produces one draft and a missed call is
caught up on the next run. A long-running `npm run worker` is an alternative for
hosts without a scheduler.

## Where things are

```
src/lib/          pure logic — no database, no framework, heavily tested
src/server/       server-only: repositories, services, adapters
src/app/          routes, server actions, API handlers
tests/unit/       pure logic tests
tests/integration/ tests against the Firestore emulator
tests/fixtures/   sample CSVs used by the GST tests
scripts/          seed, rule-pack audit, browser smoke test
docs/             everything in the table at the end of the README
```
