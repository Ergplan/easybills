# Local setup

## You need

- Node 22 (20 works)
- PostgreSQL 16 with pgvector: `sudo apt install postgresql-16 postgresql-16-pgvector` (the
  script below runs its own throwaway cluster; it does not touch a system Postgres)
- Java 11+, only for the Firebase Auth emulator (phone sign-in)
- Chromium for PDFs: set `PLAYWRIGHT_CHROMIUM_PATH`, or `npx playwright install chromium`

## Run it

```bash
npm install
cp .env.example .env.local     # the defaults work locally
npm run db:start               # Postgres on 127.0.0.1:5440, databases ekbill_dev and ekbill_test
npm run db:migrate             # applies db/migrations to ekbill_dev
npm run emulators              # terminal 1: the Firebase Auth emulator on 9099
npm run dev                    # terminal 2: http://localhost:3000
```

Sign in with any ten-digit number. The emulator sends no SMS: it prints the OTP in its terminal
and lists it at
http://127.0.0.1:9099/emulator/v1/projects/easybills-dev/verificationCodes.

To skip sign-in entirely, set `AUTH_BYPASS=true` in `.env.local`. You land on a demo business as
a test owner.

Optional, to try everything:

| For | Set |
| --- | --- |
| Photos and scans of old bills | `DOCLING_URL=http://127.0.0.1:5001` and run `docker run -p 5001:5001 quay.io/docling-project/docling-serve-cpu:v1.35.0` |
| Voice, Poocho answers, reading contracts with a model | `OPENAI_API_KEY` (locally only; on the VM it comes from Secret Manager) |

## Tests

```bash
npm test               # unit + integration; integration tests use ekbill_test, reset and migrated per run
npm run typecheck
npm run e2e            # the bill-to-payment journey at 360px (needs dev + the Auth emulator)
npm run e2e:signin     # phone, OTP and the profile
npm run e2e:home       # Home, the tabs, Aap and GST
npm run e2e:help       # the contract helper
npm run e2e:ask        # Poocho
```

The test setup refuses any `DATABASE_URL` whose database name does not contain `test`.

## Layout

```
db/migrations/          the schema, applied in order by db/migrate.mjs
src/server/db/          the pool, transactions with retry, record helpers
src/server/repos/       one file per record type; every function takes the business id
src/server/search/      Poocho: indexing, search, answers
src/server/import/      reading old bills: PDF text layer, Docling, spreadsheets
src/lib/                pure logic: money, dates, GST, contracts, copy; no database
deploy/                 Dockerfile companions: compose stack, Caddyfile, VM scripts
infra/gcp/              Terraform for the VM's secrets, backups, IP and firewall
tests/unit/             pure logic
tests/integration/      against Postgres
scripts/e2e-*.mjs       browser journeys
```
