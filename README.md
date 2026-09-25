# EasyBills

Simple billing for very small Indian businesses — freelancers, consultants, home
businesses, repair providers and monthly service providers.

> Create a bill, share it and track payment. Next month, your repeat bills are
> ready. Prepare your GST returns when due.

One owner, one business, one billing location, rupees, ordinary domestic
transactions. Not a retail POS, not an accounting package.

---

## What it does

**Billing.** Three navigation destinations — Home, Bills, Customers — and
business settings behind the profile icon. Home shows one primary action, the
monthly drafts waiting for review, and the money still to collect. No charts.

One editor serves both a Quick bill (walk-in, no customer record created) and a
Customer invoice. Discount, payment terms, HSN and supply markings live under
"More options". Drafts autosave with honest status: "Saved" means the server
has it; "Saved on this device — waiting for internet" means it does not.

**Issuing.** One transaction re-prices the bill from its stored lines, re-checks
that the document may legally be issued, allocates the next number for the
financial year, reserves that number, and writes an immutable snapshot of
seller, customer, items and tax terms. Double-tapping cannot issue twice. A
later profile edit cannot rewrite a bill already issued.

**Collecting.** Payments, part payments, reversals that keep the original entry,
and settlement deductions (such as owner-confirmed TDS) that reduce what is owed
without counting as cash or changing the invoice.

**Correcting.** An issued bill is never edited. A linked credit or debit note
carries the correction, with its own number and the owner's reason. Whether it
changes GST liability is a separate, explicit answer — adjusting what a customer
owes and adjusting a tax return are not the same act.

**Monthly drafts.** "Repeat every month" prepares a draft for review. Never
issues, never sends, never collects. Runs in a durable background job, so it
does not depend on anyone having the app open.

**AI, optional.** "Speak or type your bill" fills in the ordinary form. The app
is fully usable with it switched off.

**GST returns.** For regular GST registrants only, hidden entirely from everyone
else. Four guided steps: check sales, check purchases, review GST, file or hand
to your accountant.

---

## Quick start

```bash
npm install

cp .env.example .env.local        # fill in as needed; defaults work for local dev
npm run emulators                 # terminal 1: Firebase Auth + Firestore emulators
npm run dev                       # terminal 2: the app on http://localhost:3000
npm run worker                    # terminal 3 (optional): monthly-draft worker
```

Open http://localhost:3000, create an account, name your business, and start a
bill. Full instructions, including how to run against a real Firebase project,
are in **[docs/setup.md](docs/setup.md)**.

```bash
npm test                          # 255 tests (unit + integration against the emulator)
npm run e2e                       # browser smoke test at 360px, needs dev + emulators running
npm run typecheck
npm run build
npm run gst:audit-rules           # which tax rules have been verified, and which have not
```

---

## Architecture

| Concern | Choice |
|---|---|
| App | Next.js (App Router) + React + TypeScript |
| Data | **Firestore** for the MVP; a PostgreSQL path is documented in [docs/postgres-migration.md](docs/postgres-migration.md) |
| Auth | **Firebase Auth** (managed). The browser gets an ID token; the server verifies it and sets an httpOnly session cookie |
| Access | All Firestore access is server-side via the Admin SDK. `firestore.rules` denies **all** direct client access |
| PDFs | Server-side Chromium via `playwright-core`, rendered on demand, never stored in a public bucket |
| Background work | A durable job queue in Firestore, drained by an HTTP endpoint or a worker process |
| AI | Server-side adapters (Anthropic / OpenAI / Google / deterministic mock). No API key reaches the browser |
| GST filing | A provider adapter with a sandbox implementation. Production is off unless explicitly configured |

### Modules

```
src/lib/money/          integer paise arithmetic, rounding policy, formatting
src/lib/dates/          civil dates in Asia/Kolkata, financial years, periods
src/lib/gst/            GSTIN validation, state codes, tax engine, issuance gate,
                        effective-dated rule pack with provenance
src/lib/gst-returns/    reconciliation, GSTR-1/3B workings, readiness, QRMP, import, export
src/lib/domain/         core record shapes and input validation
src/server/repos/       business, customers, items, invoices, payments, schedules
src/server/services/    pricing, recurrence, audit, home summary, search, seed
src/server/gst/         return preparation, repository, filing adapter
src/server/ai/          model adapters, interpretation pipeline, rate limiting
src/server/jobs/        durable queue and runner
src/server/pdf/         A4 template, renderer, UPI QR
src/app/                routes, server actions, API handlers
```

### Two decisions worth knowing about

**No floating-point money, anywhere.** Every amount is an integer in paise,
every quantity an integer in milli-units, every rate an integer in basis points.
The rounding policy is documented in `src/lib/money/index.ts` and pinned by
tests. `0.1 + 0.2 === 0.3` holds, because both sides are integers.

**Arithmetic is separated from law.** Splitting a taxable value into
CGST/SGST/UTGST/IGST/cess is deterministic maths and is fully tested. Values
that come from *law* — e-invoicing thresholds, filing due dates, HSN digit
requirements, schema versions — live in an effective-dated rule pack that
records its source, who verified it and when. Nothing guesses.

---

## Honest status

Read **[docs/acceptance-report.md](docs/acceptance-report.md)** before relying on
this for real billing. In short:

- **Every legal parameter in the shipped rule pack is unverified.** The official
  CBIC and GST portal domains were unreachable from the environment this was
  built in, so no threshold, due date or schema version was confirmed from an
  official source. Dependent features block or degrade rather than guess. Run
  `npm run gst:audit-rules` to see exactly which.
- **Connected GST filing is not available.** The adapter, its sandbox and its
  tests are complete; no provider credentials exist, so production filing is
  refused rather than simulated.
- **No live AI provider has been exercised.** The mock adapter is real and
  tested; a configured provider has not been called from this build.
- **Voice input has not been tested on real mobile devices.** The recording,
  transcript-review and fallback paths are implemented and the permission-denial
  path degrades to typing.
- **No human usability testing has been done.** The protocol is written and
  ready in [docs/usability-protocol.md](docs/usability-protocol.md).
- **No qualified GST practitioner has reviewed the return workflows.** That
  review is a launch gate, and it has not happened.

---

## Documentation

| Document | What it covers |
|---|---|
| [docs/setup.md](docs/setup.md) | Local setup, Firebase project setup, deployment |
| [docs/environment.md](docs/environment.md) | Every environment variable, and what happens without it |
| [docs/owner-guide.md](docs/owner-guide.md) | Create a bill, repeat it monthly, record payment |
| [docs/gst-owner-guide.md](docs/gst-owner-guide.md) | Prepared vs Uploaded vs Filed, and the four steps |
| [docs/compliance/README.md](docs/compliance/README.md) | Supported and unsupported transactions, rule provenance |
| [docs/acceptance-report.md](docs/acceptance-report.md) | Stage-by-stage results, tests run, what is not done |
| [docs/provider-configuration.md](docs/provider-configuration.md) | Configuring AI and GST filing providers |
| [docs/filing-recovery-runbook.md](docs/filing-recovery-runbook.md) | What to do when a filing goes wrong |
| [docs/backup-restore.md](docs/backup-restore.md) | Backup, restore, and verifying a restore |
| [docs/usability-protocol.md](docs/usability-protocol.md) | The five tasks, how to run and measure them |
| [docs/postgres-migration.md](docs/postgres-migration.md) | Moving from Firestore to PostgreSQL |

---

## Licence

Not yet chosen.
