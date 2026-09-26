# EkBill

Bill banao. WhatsApp pe bhejo. Dekho kiske paise aane hain.

Billing for the very small Indian business: the electrician with four housing
societies on AMC, the tutor with nine students' parents, the tailor who stitches
uniforms for two schools. About fifty bills a year, to the same dozen people,
from a phone, on WhatsApp, in Hinglish.

One owner, one business, rupees, ordinary domestic transactions. Not a retail
POS, not an accounting package, not a GST filing tool.

---

## What it does

**Three questions, three cards, nothing else on Home.**
*Chalo, bill banate hain* -- the customers as chips; tap a name and a bill for
them opens with their details on it. *Bheje hue bills* -- this month's, latest
first. *Kiske paise aane hain* -- the total, then every unpaid bill, oldest
first, each with one button: *Yaad dilao*.

**The bill is three fields per line.** Kya kiya, kitna, rate. The total updates
as you type; *Bill banao* makes it, and the next screen is *Bill ban gaya!* with
a WhatsApp button that hands the PDF and a Hinglish note to the share sheet. A
customer with a previous bill is offered *Pichle jaisa hi?* -- last month's
lines, one tap.

**Two audiences, two registers.** The app speaks Hinglish to the owner. The bill
is formal English, for the customer. Every owner-facing string lives in one
dictionary (`src/lib/copy/dictionary.ts`); every customer message in
`src/lib/copy/messages.ts`. See `docs/voice.md`.

**Yaad dilao.** The reminder written for them: three tones (*Pyaar se*,
*Seedha*, *Doosri baar*), the first suggested from how old the bill is, the
message drafted from the bill and the UPI id, editable, then WhatsApp with the
PDF attached. *Likh lo* writes down what came in, all or part.

**GST, only for the registered.** The GST tab exists once a GST number is
entered under *Aap*. It is one screen: this quarter's bills, sales and GST by
rate, the company (B2B) bills the CA reports one by one, and *CA ko bhejo* --
one zip with the spreadsheet and every bill as PDF. Not returns. Not filing.
The CA files.

**Sign-in by phone.** Ten digits, a six-digit OTP, done. Then *Apne baare mein
batayen*: name, phone, GST number (optional), UPI ID, city and state. That is
the whole setup. (Sign-in is switched off on the deployed instance for now;
see `docs/deployment.md`.)

**The engine underneath** is unchanged from the earlier build and tested:
integer money in paise, Indian grouping, the GST tax engine and issuance
checks, per-financial-year numbering, immutable issued snapshots, PDF
rendering, Firestore repos with tenancy rules, idempotent payments.

---

## Quick start

```bash
npm install

cp .env.example .env.local        # fill in as needed; defaults work for local dev
npm run emulators                 # terminal 1: Firebase Auth + Firestore emulators
npm run dev                       # terminal 2: the app on http://localhost:3000
npm run worker                    # terminal 3 (optional): monthly-draft worker
```

Open http://localhost:3000, type any ten-digit number (the Auth emulator
prints the OTP), say who you are, and tap a name. Full instructions, including how to run against a real Firebase project,
are in **[docs/setup.md](docs/setup.md)**.

```bash
npm test                          # unit + integration tests against the emulator
npm run e2e                       # browser journey at 360px, needs dev + emulators running
npm run e2e:signin                # phone, OTP and the profile
npm run e2e:home                  # Home, the tabs, Aap and GST
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

### Screen sizes

One app, two shapes, one stylesheet. The phone layout is the product: 360px
first, three destinations along the bottom under the thumb, one column. From
1024px the same markup becomes a browser layout — the three destinations move
to a rail down the side, the content column stops stretching to whatever the
monitor is, and things folded away for want of space are simply shown: the
bill's live preview beside the form, all four GST steps at once, a list row's
date and balance across the row instead of stacked. The bill editor picks up
its side preview a little earlier, at 900px, where a tablet in landscape has
room for it while still using the tab bar.

Nothing is duplicated to achieve this. The three destinations are one list
rendered twice, only ever one of them in the document, so they cannot drift
apart. The rules that make the product what it is hold at every width, and are
asserted at fourteen of them: exactly three destinations, one primary action,
44px targets, no horizontal scrolling. `npm run e2e:desktop` checks the browser
layout; `npm run e2e` checks the phone.

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

## Deploying

Firebase App Hosting builds this repository from GitHub and serves it on Cloud
Run. The app root is the **repository root**; `apphosting.yaml` holds the
configuration. Two things are not automatic — one secret and the Firestore
rules and indexes — and both are in
[docs/deployment.md](docs/deployment.md), along with the background worker
schedule and what still is not ready for real money.

## Documentation

| Document | What it covers |
|---|---|
| [docs/setup.md](docs/setup.md) | Local setup, Firebase project setup, deployment |
| [docs/environment.md](docs/environment.md) | Every environment variable, and what happens without it |
| [docs/deployment.md](docs/deployment.md) | Getting this onto a real URL, and what is still not ready |
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
