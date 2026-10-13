# EkBill v2 — master prompt

**Status: DRAFT for review.** Nothing in this document has been run. Read it, change what you disagree with (the stage order, the stack table, the deferred-security list, the GST rule pack), then it is committed and sections 2–5 are copied into `CLAUDE.md`.

EkBill is a Hinglish billing app for small Indian businesses: a shopkeeper or contractor who finds billing software frightening makes a correct GST bill in a minute, sends it on WhatsApp, and sees who owes what. The MVP proved the concept with one owner per business and ~2,200 tests. v2 rebuilds it to serve **500 businesses**, each with an owner, staff and an accountant, with GST compliance that is current, auditable and updatable as data, a logo and a drawn signature on every bill, PAN and GSTIN captured and checked, and the ability to photograph a handwritten bill and get a clean, correct one back.

---

## 1. How to use this prompt

- This file is committed once. After that it is read from disk; nothing is pasted twice.
- Sections 2–5 are copied verbatim into `CLAUDE.md`, so they are in context in every session.
- Each stage is one Claude Code session on the VM, inside `tmux`. The operator types one line:

  ```
  Run Stage N of docs/MASTER-PROMPT.md
  ```

- The agent works until the stage's definition of done (section 9) is met, writes `docs/stages/stage-N-report.md`, commits, pushes, and **stops**. It never starts the next stage's work.
- The operator reads the report, spot-checks one invariant by hand (a grep, a click through the running app), answers the open questions in one numbered message, and types the next stage line.
- The build runs on the existing shared VM `tariff-order` (asia-south2-b), next to the tariff and fdre products. Nothing new is provisioned. Disk is the scarce resource; Stage 0 deals with it before anything else.
- At the end, an independent **OpenAI-model audit** reads the whole repository. Stage 10 prepares the pack it needs. Every stage before that is also reviewed by an OpenAI model (rule 2.12), so the final audit finds no surprises.

**Before Stage 0, on the VM (once):**

```bash
(
set -e
cd ~
command -v claude >/dev/null || { echo "Claude Code is not installed on this VM"; exit 1; }
command -v tmux >/dev/null || sudo apt-get install -y tmux
# The MVP stays where it is as a read-only reference. v2 is a fresh checkout of the same
# repository on a new branch that starts empty.
[ -d ~/easybills ] || { echo "~/easybills (the MVP checkout) is missing"; exit 1; }
cd ~/easybills && git fetch origin && git tag -f mvp-final origin/claude/admiring-wright-5w8x4g && git push -f origin mvp-final
[ -d ~/ekbill ] || git clone -b claude/admiring-wright-5w8x4g git@github-ekbill:Ergplan/easybills.git ~/ekbill
cd ~/ekbill && git checkout --orphan v2 && git rm -rfq . && git clean -fdxq
mkdir -p docs && git -C ~/easybills show claude/admiring-wright-5w8x4g:docs/MASTER-PROMPT.md > docs/MASTER-PROMPT.md
echo "Ready. Now: tmux new -s build   then   cd ~/ekbill && claude   then   /login   then   Run Stage 0 of docs/MASTER-PROMPT.md"
)
```

Note: the clone uses the existing read-only deploy key (`github-ekbill`). Pushing the `v2` branch needs a key with write access, or `gh auth login` on the VM; Stage 0 asks for this once.

---

## 2. Operating rules

These go into `CLAUDE.md` verbatim.

1. **Stage by stage.** Do only the current stage. If something from a later stage is needed to make this one work, build the smallest stub, name it in the report, and stop.
2. **Every stage ends** with: watcher green, the app running on the VM (`curl localhost:8080/api/health` returns ok), `docs/stages/stage-N-report.md` written, living documents updated, the independent review run (rule 12), commit pushed, then STOP with the report printed.
3. **Tests with the code, not after.** Unit tests for every rule, calculation and state transition. Integration tests for every API route and server action against a real Postgres. One Playwright journey per stage on real input at 360px and 1280px. A test is named for the behaviour it protects.
4. **Read `.watch/status.json` before every commit.** Red blocks the commit. Never skip, `.todo`, or mark a test expected-failure to get green. If a test is wrong, fix the test and say so in the commit message.
5. **Small commits** after each working increment, conventional messages (`feat(bills): …`, `fix(engine): …`). Tag each stage start `stage-N-start`.
6. **The MVP is a read-only input.** `~/easybills` (tag `mvp-final`) is never imported at runtime and never edited. Code copied from it carries a comment `// from mvp-final: <path>` and comes with its tests. Section 8.1 lists what is worth copying; anything else is rewritten.
7. **One language per layer.** TypeScript everywhere (app, worker, engine, scripts, tests). SQL in migrations and `*.sql` files only. No Python in the product.
8. **Every model call goes through `packages/ai`**: typed input and output (zod), a versioned prompt loaded from `packages/ai/prompts/<name>/v<N>.md`, a retry policy, a timeout, and one row in `ai_calls` per call (model, prompt version, tokens, latency, cost, business_id, outcome). No `fetch` to a model endpoint anywhere else.
9. **Keep the folder layout** (section 5). A new top-level folder is added to `docs/ARCHITECTURE.md` in the same commit that creates it. No `utils/`, `misc/`, `helpers/`, `temp/`, `old/`.
10. **Secrets by environment variable.** `.env` is gitignored and lives on the VM; `.env.example` lists every name with a one-line meaning. Production values come from Secret Manager through `deploy/vm/up.sh`, as in the MVP. Secrets never appear in chat, in a commit, in a log line or in an error message.
11. **Security that is deferred is listed, not forgotten.** Section 4.3 says exactly what is switched off during the build and which stage switches it on. Do not add it early; do not drop it from the list.
12. **Independent review before every stage report, from Stage 0 onward.** Run `npm run review:stage` which sends to an **OpenAI model** (a different family from the builder), in a fresh context with no access to this session, exactly three things: the stage diff (`git diff stage-N-start..HEAD`), `CLAUDE.md`, and the stage prompt. It answers a fixed checklist and nothing else: (a) every invariant upheld, citing file and line, or the violation; (b) every route and server action added has a test; (c) every write to an authoritative table is audited; (d) generated documents regenerate without diff; (e) any claim in the draft stage report that the code does not support. Fix every finding and rerun until it reports **no new code defect**. Findings that cannot be resolved by code (by-design behaviour, statements a diff cannot prove, decisions pending from the operator) go in the report with a one-line rationale and do not block the stage.
13. **Living documents in the same commit** as the code that changes them (section 5.3).
14. **Correctness beats speed, and traceability beats cleverness.** When two designs tie, choose the one a CA could follow from the bill to the rule that produced each number.
15. **Hinglish on screen, English on the bill.** Every string the owner sees comes from the copy dictionary with `en` and `hi` forms; the printed document is English with Indian number formatting. No jargon in `hi` (the MVP's copy tests enforce this; keep them).
16. **Shared VM discipline.** Never touch the tariff or fdre products: not their compose projects, containers, images, volumes (`tariff_pgdata` and friends), ports (3000, 5432, 5433, 8000), firewall rules, Terraform state (`tariff/dev`), or files outside `~/ekbill` and `~/easybills`. Never run `docker system prune` or `docker volume prune`. Compose project is always `-p ekbill`. Check free disk at the start of every session; below 8 GB, stop and run `deploy/vm/free-space.sh` before building.
17. **Rate limits.** Analyse sequentially; use file trees and greps, not whole-directory reads. On a 429, wait 60 seconds and resume.
18. **Rebuild images when dependencies change**, and check container health at the start of each session.
19. **Ask once, in writing.** Questions for the operator go at the end of the stage report, numbered. Do not stop mid-stage to ask unless an invariant would otherwise be violated.

---

## 3. Invariants

These hold in every stage and override anything else in this document. If a stage prompt conflicts with one, the invariant wins and the agent flags the conflict in the report.

**I1 — Tenancy is total.** Every table that holds business data has a `business_id` column, `NOT NULL`, with a foreign key. Every query runs through a repository function that takes a `TenantScope` (business id + acting user id) as its first argument; there is no repository function without one. Postgres row-level security is enabled on every such table with a policy on `current_setting('app.business_id')`, set per transaction by `withTenant()`. Test: `tests/integration/tenancy.test.ts` creates two businesses and asserts that every repository function, called with scope A, returns nothing and changes nothing of B — generated from the repository module list so a new function cannot be missed.

**I2 — One writer for issued documents.** Only `packages/engine/issue.ts#issueDocument()` moves a document to `status = 'issued'`, allocates its number and writes its `issued_snapshot`. A Postgres trigger refuses any `UPDATE` to `number`, `issued_at`, `issued_snapshot`, `totals` or `lines` on a row whose status is `issued` or `cancelled`. Corrections are new documents (credit note, debit note, cancel-and-redo) that link back; the original never changes. Everything a customer sees (PDF, JPG, receipt, WhatsApp text, GST workings) is rendered from `issued_snapshot`, never from the live business or customer record.

**I3 — Numbers are gapless, per series, per financial year, and never reused.** Allocation happens inside the issuing transaction with `SELECT … FOR UPDATE` on the series counter; a unique index on `(business_id, series_id, financial_year, number)` backs it. Test: 50 concurrent `issueDocument()` calls on one series produce exactly 1…50. The MVP's numbering behaviour (prefix, zero padding, optional FY suffix, next-number can only go up, FY rollover) is kept as is.

**I4 — Money and tax are deterministic, integer, and come from one engine.** Amounts are integer paise, rates are integer basis points, rounding is banker's-free and specified in `packages/engine/money.ts`. `packages/engine/tax.ts#computeTax()` is the only tax calculation; the bill form preview, the PDF, the receipt and the GST workings all read its output, and `tests/unit/one-engine.test.ts` asserts they agree on a fixture set. No model call, no floating point, no `Date.now()` inside the engine.

**I5 — GST rules are versioned data, not code.** Rate slabs, selectable rates, document types and their mandatory fields, HSN digit requirements, e-invoice thresholds, composition limits, place-of-supply rules and return calendars live in `packages/engine/rules/gst/*.json`, each entry with `effectiveFrom`, `effectiveTo`, `source` (an official URL), `verifiedOn` and `verifiedBy`. The engine selects rules by document date. A rule change is a data change with a fixture test; it never needs a code change. A rule without a source or a verification date fails `npm run rules:check`.

**I6 — Model output lands in staging only.** Anything produced by a model (a bill read from a photo, a voice command, a suggested rate, an answer about records) is written to `extractions` or `ai_calls` with provenance (input hash, model, prompt version, confidence per field) and becomes a bill, a customer or a setting only when a human taps the button that commits it. Model output never writes an authoritative table directly; a trigger forbids it (`current_setting('app.actor_kind') = 'model'` cannot insert into authoritative tables).

**I7 — Every authoritative write is audited and attributed.** `documents`, `payments`, `adjustments`, `customers`, `items`, `businesses`, `memberships` and `series` each have a trigger that appends to `audit_events` (business_id, actor user id, actor kind, table, row id, action, before, after, request id, at). `audit_events` is append-only (no UPDATE/DELETE grant). Every request carries a request id that reaches the logs and the audit row.

**I8 — Roles are enforced at the repository, not the screen.** `TenantScope` carries the acting user's role; each repository write declares the roles that may call it, and `tests/integration/roles.test.ts` is generated from those declarations: staff cannot change settings or delete, accountant cannot write anything, owner can do everything. The UI hides what a role cannot do, but hiding is not the enforcement.

---

## 4. Locked decisions

Not reopened unless analysis of the MVP shows something materially better; then the decisions log records why.

### 4.1 Stack

| Area | Decision | Why |
| --- | --- | --- |
| Repository | Same GitHub repository `Ergplan/easybills`, new orphan branch `v2`; MVP frozen at tag `mvp-final`; `v2` becomes the default branch after Stage 10 | One place, one history, the MVP readable with `git show mvp-final:…` |
| Layout | npm workspaces monorepo: `apps/web`, `apps/worker`, `packages/engine`, `packages/ai`, `packages/db`, `packages/copy` | The engine stays pure and testable without a browser or a database |
| Language | TypeScript 5.x, strict, everywhere | One language per layer; the proven engine is TypeScript |
| Web app | Next.js 16 App Router, React 19, server actions for writes, route handlers for files and webhooks, standalone output | Already works on phones and on the VM; SSR for slow Android browsers |
| API shape | Server actions and route handlers validated with zod at the edge; one `ActionResult<T>` type | No second API server to run on a shared VM |
| Database | PostgreSQL 16 with pgvector (the existing image), **relational columns**, not jsonb documents | 500 tenants need indexes, constraints, RLS and reporting that jsonb makes hard |
| ORM and migrations | Drizzle ORM with `drizzle-kit` SQL migrations committed to `packages/db/migrations`; a drift check in the watcher and CI | Typed schema in code, plain SQL on disk, triggers and RLS written by hand in the same migrations |
| Background work | `apps/worker`, a Node process using `pg-boss` (Postgres-backed queue) for OCR, handwriting reading, PDF/JPG rendering, embeddings, reminders, nightly backup checks | No Redis: one fewer container on a shared VM; jobs are rows, so they are auditable |
| Auth | Firebase Auth phone OTP for people (as the MVP), session cookie minted server-side; **during the build** a dev user-switcher replaces OTP (section 4.3) | OTP is what these users have; the switcher keeps testing fast and never locks anyone out |
| Tenancy and roles | One business per tenant; memberships with role `owner`, `staff`, `accountant`; invite by phone number | Section 3, I1 and I8 |
| Models | OpenAI through `packages/ai`: a vision-capable model for handwritten and photographed bills, a text model for Poocho answers and GST explanations, Realtime for voice; model IDs by environment variable with the defaults recorded in the decisions log | The account and key already exist; the reviewer and auditor are the same family, which the builder is not |
| Printed-document OCR | docling-serve (existing container) for printed PDFs and scans; the vision model for handwriting; Docling output is also fed to the vision model when confidence is low | Docling is cheap and local; handwriting needs a model |
| PDF and images | Playwright Chromium in the app container (as the MVP): HTML template → PDF (A4/A5/80mm/58mm) and JPEG | Proven, one renderer for every format |
| Search / Poocho | Postgres full text + pgvector hybrid, as the MVP, moved into the worker for indexing | Works, local, no extra service |
| Voice | OpenAI Realtime over WebRTC, server-minted client secrets, tools that fill fields and never commit (I6) | MVP design, kept |
| Copy | `packages/copy` dictionary `{en, hi}` with the MVP's jargon and length tests | Rule 15 |
| Frontend UI | React server components + a small client layer; CSS with design tokens (no Tailwind, no component library); the MVP's visual language (reception, task cards, Hinglish) kept | Owners liked it; a library would add 2 MB to a 3G page |
| Logs and metrics | `pino` JSON logs with request id and business id; `/api/health` as the MVP; `/api/metrics` in Prometheus text format (request count/latency by route, job queue depth, model cost) | Enough to run 500 businesses on one VM and to see trouble coming |
| Deployment | Docker Compose project `ekbill` on `tariff-order`: `db`, `docling`, `app`, `worker`, `caddy`; one image for app and worker; Caddy with automatic HTTPS; the existing `deploy/vm/*.sh` scripts adapted | Nothing new to provision |
| CI | GitHub Actions on push: the same checks as the watcher, plus Playwright on a Postgres service | The watcher is for the agent; CI is for everyone else |
| Testing | vitest (unit, integration against a real Postgres), Playwright (journeys), k6 (load, Stage 9) | What the MVP used, plus load |
| Reviewer and auditor | OpenAI model via `scripts/review-stage.mjs` (Responses API, key in `.env` as `OPENAI_REVIEW_API_KEY`); the final audit by the operator's OpenAI agent on the Stage 10 pack | Rule 12; a reviewer from the builder's family shares its blind spots |

### 4.2 Product scope for v2 (what "the core concept" means)

Kept from the MVP: the front-desk home, one-question-at-a-time setup, three-field bill lines, "Pichle jaisa hi", WhatsApp share with PDF or photo, Paise aane hain, Yaad dilao with tone and language, Likh lo, GST tab only when registered, the guided ring tour, voice, Poocho, old-bill import, contract billing helper, bill designs and paper sizes, logo.

New in v2: roles and invites; PAN and GSTIN capture with checksum and consistency checks for the business and for customers; a drawn signature on bills; handwritten or photographed bill → clean bill; an items master with HSN/SAC and rates; multiple numbering series; credit and debit notes as first-class documents; GST workings (GSTR-1 tables, HSN summary, 3B figures) with rule-pack versioning; per-bill GST intelligence (checks and plain-Hinglish explanations); e-invoice readiness; CA export pack; backups with a tested restore; metrics; load tested for 500 businesses.

Out of scope for v2 (listed so nobody builds them by accident): filing returns on the GST portal; e-invoice IRN generation through an IRP (readiness and the IRN field only); e-way bills; TDS/TCS under GST; composition scheme returns (CMP-08) — a composition business can bill (Bill of Supply) but gets no return workings; inventory and stock; purchases and ITC; multi-currency; multi-GSTIN per business; payroll.

### 4.3 Security posture during the build (deferred, explicitly)

The operator's instruction: keep security low during development and testing so the VM is never locked or stopped. The following are **off until the stage named**, and the stage that turns each one on must do so in a way that cannot lock the operator out.

| Deferred | Until | How it is replaced meanwhile |
| --- | --- | --- |
| Phone OTP sign-in | Stage 9 | `AUTH_MODE=switcher`: a dev screen lists seeded test users (owner, staff, accountant of several businesses) and sets the session cookie for the chosen one. Roles and tenancy are still enforced (I1, I8). `AUTH_MODE=otp` is the production value. |
| Public exposure limits (rate limits, WAF, bot checks) | Stage 9 (rate limits), later (WAF) | Caddy's basic-auth gate stays in front of the app, as the MVP |
| SSH restrictions, deny rules, IP allowlists | Never in this build | The operator uses Cloud Shell; the VM's firewall is not changed except the existing `ekbill-allow-web` rule. No deny rules, no IAP-only rules, no allowlists: these are what lock people out. |
| Secret rotation, KMS, DLP | Later | Secret Manager as today |
| Row-level security | **On from Stage 1** | Not deferred: it is a column and a policy now, a migration later |
| Audit log | **On from Stage 1** | Not deferred, same reason |
| HTTPS | **On** | Caddy, as today |
| Backups | **On from Stage 0** (nightly, verified non-empty) | Restore drill in Stage 9 |

Data on the VM during the build is test data. The report of every stage repeats: "Sign-in is switched off; do not put a real business's books here yet."

---

## 5. Folder layout, continuous testing, living documents

### 5.1 Layout

```
ekbill/
  apps/
    web/                 # Next.js: screens, server actions, route handlers; no business rules
      app/               #   routes ((app) shell, start, signin, api/)
      components/        #   React components, by screen
      actions/           #   server actions: validate input, call a service, return ActionResult
      lib/               #   browser-side helpers only (guide ring, voice client, share)
    worker/              # pg-boss workers: read-bill, render-document, index-search, reminders, backup-check
  packages/
    engine/              # pure TypeScript, no I/O: money, tax, rules, issuance, numbering, documents, gst workings
      rules/gst/         #   the GST rule pack (JSON, versioned, sourced) + fixtures
    db/                  # Drizzle schema, migrations (SQL), repositories (every function takes TenantScope), triggers, RLS
    ai/                  # the one model client: prompts/<name>/v<N>.md, typed calls, ai_calls logging, evaluation sets
    copy/                # the Hinglish dictionary and its tests
    render/              # HTML templates for documents (designs, papers), shared by app and worker
  deploy/                # Dockerfile, docker-compose.yml, Caddyfile, vm/*.sh (adapted from the MVP)
  scripts/               # review-stage.mjs, seed.mjs, e2e/*.mjs, load/*.js (k6)
  tests/
    unit/                # mirrors packages/*
    integration/         # against a real Postgres: repositories, actions, triggers, RLS, roles, tenancy
    e2e/                 # Playwright journeys, one per stage
    fixtures/            # bills, photos of handwritten bills, GST rule fixtures, expected PDFs
  docs/
    MASTER-PROMPT.md     # this file
    ARCHITECTURE.md      # living: components, data model, critical paths, API surface, deployment
    DECISIONS.md         # living, dated
    KNOWN-GAPS.md        # living
    FIELD-TRACE.md       # generated: every user-visible field → table.column → who may write it
    stages/              # stage-N-report.md
    audit/               # Stage 10: the pack for the OpenAI audit
  .watch/                # watcher status.json and log (gitignored)
  CLAUDE.md              # sections 2–5 of this file, verbatim
```

### 5.2 Continuous testing

`npm run watch` starts beside the app in Stage 0 and stays running in a tmux window. On every save it runs, in order, stopping at the first red: `eslint`, `prettier --check`, `tsc --noEmit` for every workspace, vitest unit tests for the changed package then the full unit suite, `drizzle-kit check` (schema vs migrations drift), `npm run rules:check` (rule pack sources and dates), `npm run trace:check` (FIELD-TRACE.md regenerates without diff), and the integration suite when `packages/db` or `apps/web/actions` changed. It writes `.watch/status.json` (`{ ok, failed: [...], at }`) and `.watch/log`. The agent reads `status.json` before every commit (rule 4). Playwright journeys, load tests and anything that calls a paid model are marked `@slow` and excluded from the watcher; they run at the stage boundary and in CI's nightly job. The same checks run in GitHub Actions on push.

### 5.3 Living documents

- `docs/ARCHITECTURE.md`: component diagram (text), data model table (every table: purpose, owner, who writes), the critical paths with real function names (make a bill, read a handwritten bill, compute GST workings, allocate a number), the API surface (every action and route with its roles), deployment. Each stage appends a "What changed in Stage N" list.
- `docs/DECISIONS.md`: dated entries: decision, options considered, why, who asked.
- `docs/KNOWN-GAPS.md`: what is knowingly incomplete, with the stage or condition that closes it.
- `docs/FIELD-TRACE.md`: generated by `npm run trace` from zod schemas and Drizzle tables: every field an owner can see or type → table.column → roles that may write it → validation. CI fails on drift or on a field with no owner.

---

## 6. Plan

Ordered by what becomes permanent earliest. Dates are not planned; stop points are.

| Stage | Name | Permanent things it creates | Stop point |
| --- | --- | --- | --- |
| 0 | Ground: disk, scaffold, watcher, review, CI, docs | Repository shape, tooling, the review loop | Watcher green on an empty app; review ran; app serves `/api/health` on the VM |
| 1 | Identity, tenancy, roles, audit | Users, businesses, memberships, audit log, RLS, TenantScope | Tenancy and roles tests generated and green |
| 2 | The engine: money, rules, tax, documents, numbering, issuance | Everything in I2–I5; the GST rule pack | Engine ≥ MVP test parity; rule pack verified and sourced |
| 3 | Business profile: PAN, GSTIN, logo, signature, bank/UPI, series, bill look | `businesses`, `series`, `business_files` | A business set up end to end with a signed, logo'd sample bill |
| 4 | Customers and items | `customers`, `items`, HSN/SAC, import | Import of the MVP's CSV/PDF fixtures reproduces its results |
| 5 | Bills, documents, money, sharing | `documents`, `payments`, `adjustments`, rendering, WhatsApp, dues, reminders | The MVP's smoke journey passes on v2 |
| 6 | Handwritten and photographed bill → clean bill | `uploads`, `extractions`, the review screen, the evaluation set | Evaluation set scores recorded; nothing commits without a tap |
| 7 | GST compliance and intelligence | GST workings, per-bill checks, e-invoice readiness, CA pack, rule-update workflow | Workings match hand-computed fixtures; every rule has a source |
| 8 | The front desk: screens, roles in the UI, invites, voice, guide, Poocho | The owner-facing app complete | Every MVP journey ported and green; flow audit green |
| 9 | 500 businesses: performance, load, backups, monitoring, rate limits, OTP sign-in | Operational readiness | k6 at 500 tenants within budget; restore drill passed; OTP on without lock-out |
| 10 | Audit pack and handover | `docs/audit/*`, default branch, release tag | The OpenAI audit can start from the pack alone |

Stages 1 and 2 get the most review time; they are the ones that are expensive to change. Stage 8 is the largest by screen count but changes nothing permanent.

---

## 7. Stage prompts

Each stage prompt is what the agent reads for `Run Stage N`. It assumes sections 2–5 are in context.

### Stage 0 — Ground

```
Stage 0: make the repository, the tooling and the review loop, on the shared VM, without touching the other products. Build no product feature.

Disk first. Run df -h /. If less than 15 GB is free: run ~/easybills/deploy/vm/free-space.sh (EkBill's old images only), then report what docker system df shows for the other projects WITHOUT touching them, and ask the operator in the report whether to stop the MVP's containers (docker compose -p ekbill down keeps its volume). Do not build images until 15 GB is free. Record the free space before and after in the report.

Repository. You are on branch v2 of Ergplan/easybills, which is empty except docs/MASTER-PROMPT.md. Create the layout in section 5.1 exactly, npm workspaces, TypeScript strict, eslint + prettier, vitest, Playwright (use the VM's existing Chromium at /opt or playwright-core with PLAYWRIGHT_CHROMIUM_PATH as the MVP did), Drizzle with an empty schema and a first migration that creates schema_migrations and the extensions (pgvector, pgcrypto). Set a repo-local git user.name and user.email. Write CLAUDE.md as sections 2–5 verbatim. Write .env.example with every name the stages will need (DATABASE_URL, AUTH_MODE, OPENAI_API_KEY, OPENAI_REVIEW_API_KEY, OPENAI_VISION_MODEL, OPENAI_TEXT_MODEL, OPENAI_REALTIME_MODEL, DOCLING_URL, DOCLING_API_KEY, EKBILL_DOMAIN, …) and ask the operator in the report to fill .env on the VM (nano .env in a second tmux window). Push needs write access to GitHub: if the deploy key is read-only, ask the operator to run gh auth login on the VM; do not create or download any key.

Watcher. scripts/watch.mjs as in section 5.2, writing .watch/status.json; npm run watch. Start it in a tmux window named watch and leave it running.

Review loop. scripts/review-stage.mjs: reads stage-N-start..HEAD diff, CLAUDE.md and the stage prompt (the fenced block for stage N from docs/MASTER-PROMPT.md), sends them to the OpenAI model named by OPENAI_REVIEW_MODEL with the checklist from rule 12, and writes docs/stages/stage-N-review-<k>.md. npm run review:stage -- N. Prove it works on this stage.

CI. .github/workflows/ci.yml running the watcher's checks plus Playwright with a Postgres service, on push to v2.

Deployment. deploy/: Dockerfile (one image, two commands: web and worker), docker-compose.yml (db with the existing pgdata volume name CHANGED to ekbill_v2_pgdata so the MVP's data is untouched, docling, app, worker, caddy), Caddyfile, vm/{lib,up,backup,restore,free-space,set-openai-key}.sh adapted from the MVP (read them from ~/easybills; keep the Secret Manager flow; keep -p ekbill). The MVP's containers are stopped with down (volume kept) only after the operator says so; until then v2 binds app to 127.0.0.1:8081 and caddy is not started, so both can run. Bring v2 up on the VM: /api/health returns {ok:true, schema, database:"ok"} with an empty schema.

Living documents. ARCHITECTURE.md (the layout and the empty data model), DECISIONS.md (the stack table as dated entries, plus the orphan-branch decision), KNOWN-GAPS.md (empty app), FIELD-TRACE.md generated empty, docs/stages/stage-0-report.md.

Tests required: the watcher runs and goes red on a deliberately failing test then green when it is removed (documented in the report, not committed red); scripts/review-stage.mjs has a unit test with a stubbed model; the health route has an integration test.

Done when: df shows ≥ 15 GB free, the watcher is green, CI is green on the pushed commit, /api/health answers on the VM, the review ran and its findings are fixed or listed, and the report lists the operator's questions (write access, .env, stopping the MVP). STOP.
```

### Stage 1 — Identity, tenancy, roles, audit

```
Stage 1: the people, the businesses, who may do what, and the audit trail. No bills yet. This is the stage that is hardest to change later; take the review seriously.

Data model (packages/db/schema, one migration):
- users: id uuid, phone_e164 text unique, name, created_at, last_seen_at.
- businesses: id, legal_name, trade_name, status (active|suspended), created_at, updated_at, created_by. (Profile fields come in Stage 3; the row exists now.)
- memberships: id, business_id, user_id, role (owner|staff|accountant), status (invited|active|removed), invited_by, invited_at, accepted_at; unique (business_id, user_id); exactly one active owner per business enforced by a partial unique index.
- audit_events: id bigserial, business_id, actor_user_id nullable, actor_kind (user|system|model), table_name, row_id, action (insert|update|delete), before jsonb, after jsonb, request_id, at. Append-only: revoke UPDATE/DELETE from the app role.
- sessions: id, user_id, business_id (the business this session is acting in), role snapshot, expires_at, created_at, user_agent.
- Every business table from here on gets business_id NOT NULL + FK + RLS; write the helper that applies the policy and the audit trigger to a table (packages/db/tenancy.sql) so later stages call it rather than copy it.

Services:
- packages/db/scope.ts: TenantScope {businessId, userId, role, requestId}; withTenant(scope, fn) opens a transaction, sets app.business_id, app.user_id, app.actor_kind, app.request_id, runs fn.
- packages/db/repos/*: users, businesses, memberships; every function's first argument is TenantScope; each write declares allowedRoles and throws NotAllowed otherwise. The role check lives in one wrapper, allow(scope, roles), used by every write.
- apps/web/lib/auth: AUTH_MODE=switcher → /dev/switch lists seeded users and businesses and sets the session cookie; AUTH_MODE=otp → routes exist but return 501 until Stage 9. Session cookie signed with a server secret; the current scope is read once per request in a server-side helper and passed down.
- Seed (scripts/seed.mjs): three businesses with owner+staff+accountant each, deterministic ids, used by every later test.
- Request id middleware; pino logger with request id and business id on every line.

Interface: the shell (app layout, tab bar placeholder), /dev/switch, a /you placeholder showing who you are and your role.

Tests required: tenancy.test.ts generated from the repository module list (I1); roles.test.ts generated from allowedRoles declarations (I8); audit trigger test (every write appends exactly one row with before/after); RLS test with a raw connection that sets no app.business_id and sees no rows; session test; a Playwright journey: switch to owner of business A, see A's name; switch to staff of B, see B's name.

Done when: the generated tests exist and are green, a cross-tenant read returns nothing at the SQL level (prove it in the report with the query), ARCHITECTURE.md has the data model table, FIELD-TRACE.md lists the user and business fields, the review found no new code defect. STOP.
```

### Stage 2 — The engine

```
Stage 2: packages/engine, pure and complete, plus the document tables it writes through issueDocument(). No screens.

Salvage (rule 6, section 8.1): copy from ~/easybills (tag mvp-final) with origin comments and their tests: lib/money, lib/gst/tax-engine, lib/gst/gstin (GSTIN checksum, PAN inside GSTIN, state code), lib/gst/state-codes, lib/gst/scenarios (document kind assessment, blockers in plain language), lib/domain/bill-guard (duplicate detection, rate oddities, number preview), the numbering behaviour from server/repos/invoices (formatNumber, counters, FY rollover), lib/dates (civil dates, IST, financial year), lib/domain/contract (contract billing maths). Re-shape them to the v2 types; keep every test passing (adapt names, not behaviour). Record in the report which MVP tests were dropped and why.

Rule pack (I5): packages/engine/rules/gst/ with JSON files and a zod schema: rates.json (slabs with effectiveFrom/To: 0, 5, 18, 40 from 2025-09-22; 0, 5, 12, 18, 28 before; 0.25 and 3 as special), document-types.json (tax-invoice, bill-of-supply, credit-note, debit-note, receipt-voucher, each with mandatory fields per Rule 46/49/53 and when it applies), hsn.json (digit requirement by turnover band, B2B vs B2C), e-invoice.json (threshold, 30-day reporting band, exempt sectors), composition.json (limits, the mandatory bill-of-supply legend), place-of-supply.json (intra/inter-state decision for goods and for services in the cases this app supports; everything else → "ask"), returns-calendar.json (GSTR-1/IFF/3B due days, QRMP), registration-thresholds.json, credit-note-limits.json. Every entry: source URL (cbic-gst.gov.in, gst.gov.in, PIB), verifiedOn, verifiedBy ("agent, from <url>" or "operator"). Section 8.2 is the starting content: VERIFY EACH ENTRY against its source before marking it verified; where a source cannot be reached, mark verifiedBy: "unverified" and list it in the report. npm run rules:check fails on missing source/date.

Engine modules (no I/O; typed; documented):
- money.ts: Paise, Bp, add/multiply/round, Indian formatting, amount in words.
- rules.ts: load the pack, select by date, explain(ruleId) returns {en, hi} plain-language text for the intelligence layer.
- tax.ts: computeTax(lines, context) → per-line and total CGST/SGST/IGST/cess, taxable value, rounding, with the rule ids used. Per-line rates. Inclusive and exclusive pricing. Cess by rate only.
- assess.ts: assessDocument(business, customer, lines, date, flags) → documentKind, title, mandatory-field blockers in Hinglish with "what you can do", notices, the rule ids applied (replaces MVP scenarios + checks for: GSTIN present when charging tax, place of supply known, HSN digits for the turnover band, B2C > ₹50,000 recipient details, composition legend, e-invoice applicability flag, credit-note date limit, 30-day IRN band warning).
- numbering.ts: series config, format, next, FY rollover, validation (≤16 chars, allowed characters).
- issue.ts: issueDocument(scope, draftId) — the ONE writer (I2): loads the draft FOR UPDATE, runs assess, refuses on blockers, computes tax, allocates the number FOR UPDATE on the series row, writes issued_snapshot (seller, customer, lines, totals, rule pack version, rule ids, document kind, place of supply, signature/logo refs), status=issued, audit row. Cancel, credit note and debit note are separate functions that create linked rows.
- workings.ts: GSTR-1 tables (B2B, B2C small/large, CDNR, HSN summary), 3B outward figures, by period, from issued snapshots only. Port from the MVP's gst-returns/workings with the v2 shapes.

Data model: series (business_id, name, prefix, padding, include_fy, next_number, fy, active), documents (business_id, series_id, kind, status draft|issued|cancelled, number, financial_year, dates, customer_id + customer snapshot columns, place_of_supply_state, flags, lines jsonb for drafts, totals, issued_snapshot jsonb, linked_document_id, cancelled_at/reason, revision), document_lines is NOT a table (lines live in the snapshot; the HSN summary reads the snapshot), the immutability trigger (I2), the audit trigger, RLS.

Tests required: all salvaged tests green; rules fixtures (one per JSON entry, with a bill dated inside and outside its effective window); tax fixtures from the MVP plus per-line mixed rates, inclusive pricing, inter-state, rounding; one-engine.test.ts (I4) on 20 fixtures; numbering concurrency test (I3, 50 parallel); issuance integration tests (draft→issued, blockers refuse, cancel, credit note links, immutability trigger refuses UPDATE, audit rows); workings fixtures hand-computed and checked in with the arithmetic shown in a comment.

Done when: npm run rules:check passes with zero unverified entries OR the unverified list is in the report with reasons; engine unit tests ≥ the MVP's count for the same modules; I2–I5 each cited to file:line in the report; the review found no new code defect. STOP.
```

### Stage 3 — Business profile

```
Stage 3: everything about the business that prints on a bill or decides its tax, captured once, with one Save; and the first-time setup one question at a time (the MVP's wizard, including the "Namaste ji! Hum pehli baar mil rahe hain…" opening).

Data model: extend businesses (address lines, city, pincode, state_code, phone, email, pan, gstin, registration_type regular|composition|not-registered|not-sure, e_invoicing_applies bool nullable, declared_turnover_band, bank: holder/account/ifsc/bank name/upi, default_payment_terms_days, bill design/paper/share-as/accent, logo_file_id, signature_file_id, default_series_id); business_files (business_id, kind logo|signature|other, bytes bytea ≤ 300 KB, mime, sha256, created_by). Files stay in Postgres (no bucket: nothing public, backed up with the database).

Checks (engine, pure): PAN format and checksum-style structure; GSTIN checksum, PAN-inside-GSTIN consistency (the GSTIN's PAN must equal the PAN field when both given), state code from GSTIN must equal the chosen state; registration_type must agree with GSTIN presence; composition requires the legend; e_invoicing_applies must be answered when turnover band ≥ ₹5 crore (rule pack).

Signature: a signature pad screen (canvas, finger or stylus, "Phir se" to redraw, "Theek hai" to keep) producing a transparent PNG trimmed to the strokes, ≤ 60 KB; stored as business_files kind=signature; printed on every document as the authorised signatory with "For <legal name>". Owner only. The MVP's phone field is NOT replaced: phone stays (it is the login); the signature is a new step after it in setup and a card in Aap.

Logo: the MVP's picker (shrink in browser, PNG/JPEG/WebP) stored in business_files.

Services: profile repo (owner writes; staff and accountant read), setup wizard actions, sample bill render (reuse Stage 5's renderer? No — Stage 5 does not exist yet: render a static preview card now and a real sample in Stage 5; list it in KNOWN-GAPS).

Interface: /start wizard (name → phone shown → PAN → GST hai? → GSTIN (+ e-invoice question when applicable) → UPI → place → signature → review); /you (Aap) with sections: dukaan, PAN & GST, paise kaise dein, bill number series (multiple series: add/rename/retire, choose default), bill kaisa dikhe (logo, signature, design, colour, paper, share-as), app ki jaankari.

Tests required: PAN/GSTIN/consistency unit tests (including the MVP's); files size/mime tests; signature trimming test on fixture strokes; roles test regenerates (owner-only writes); Playwright: full setup with signature on a 360px screen, then Aap shows everything and Save works once.

Done when: a business can be set up end to end with a logo and a signature, both visible on /you, FIELD-TRACE lists every profile field with owner-only write, review clean. STOP.
```

### Stage 4 — Customers and items

```
Stage 4: who the bills go to and what is usually on them.

Data model: customers (business_id, name, contact_person, phone, email, address, city, pincode, state_code, gstin, pan, language, language_source, notes, archived, last_billed_at; unique (business_id, phone) when phone present), items (business_id, name, description, hsn_sac, unit, default_rate_paise, default_tax_bp, price_includes_tax, archived; unique (business_id, lower(name))), imports (business_id, file sha256, kind, read_by docling|csv|xlsx|pdf-text, rows jsonb, status, created_by) — staging for imported customers and items (I6 applies: nothing lands in customers/items without the owner ticking rows).

Services: customers repo (staff may create and edit, not delete), items repo, GSTIN→state/PAN derivation (engine), language guess (salvage lib/domain/language-guess), import pipeline in the worker: CSV/XLSX parsing (salvage), PDF text via pdfjs, Docling for scans; matching against existing customers (salvage the import matcher); "customer add karo" commits ticked rows.

Interface: /customers (picker with search, Naya customer, Purane bills upload karo), /customers/new, /customers/[id] (bills first, details folded, language, Inka bill banao), /items (list, add, edit; HSN/SAC with a lookup field that suggests from a bundled HSN/SAC index — the index is data in packages/engine/rules/hsn-index.json, sourced).

Tests required: repo + roles + tenancy regenerate; import fixtures from the MVP (CSV, the INV-001 PDF) reproduce the MVP's results (1 customer from the PDF, 3 from the CSV, duplicates recognised); items uniqueness; Playwright: add a customer, import the fixtures, tick two, see them in the directory.

Done when: the MVP's e2e-smoke import section passes on v2, FIELD-TRACE updated, review clean. STOP.
```

### Stage 5 — Bills, documents, money, sharing

```
Stage 5: the reason the app exists. Make a bill in a minute, send it, record the money, remind.

Services (apps/web/actions + worker):
- Draft: startDocument(scope, customerId|null, seriesId?) creates a draft; the three-field form (kya kiya, kitna, rate) with per-line GST rate when "har cheez ka alag rate", "GST lagega? Haan/Nahi" for registered businesses (Nahi → bill of supply), items master suggestions, "Pichle jaisa hi", duplicate and rate-oddity guards (salvaged), customer GSTIN/state capture for a new customer inline.
- Issue: the make bar → issueDocument() (Stage 2). Done screen with WhatsApp (PDF or photo as chosen), copy message, other sizes.
- Rendering (packages/render + worker job render-document): the MVP's templates (classic/modern/simple; A4/A5/80mm/58mm; JPEG) with logo and signature from the snapshot; rendered once at issue time into document_files (business_id, document_id, kind pdf|jpg, paper, design, bytes, sha256) and re-rendered on demand for another size; the route serves bytes with the roles check.
- Credit note / debit note / cancel-and-redo as documents linked to the original (Stage 2 functions) with their own numbering series (series kind), printed with the original's number and date.
- Payments: payments (business_id, customer_id, received_on, amount, method, reference, note, allocations jsonb, unapplied, reversal links) with Likh lo (full/part), Kam karo (settlement deduction as an adjustment), balance = one function (salvage computeBalance).
- Dues: Kiske paise aane hain (total, by customer, oldest first); reminders: Yaad dilao with tone and the customer's language (salvage messages), reminders_sent counter, worker job that computes "due today" lists (no auto-sending; the owner taps).
- Search index job (Poocho data) for issued documents.

Interface: /bills/start, /bills/[id] (form | done | view), /bills/[id]/remind, /bills, /dues; the sticky make bar; the top bar with back-trail (salvage nav-trail).

Tests required: action integration tests for every action (roles: staff can make bills and record money, cannot cancel or credit-note — owner only; accountant read-only); render snapshot tests (HTML → compare key strings; PDF page size by paper); payment lifecycle (issue → part → full → reversal → balance 0) ported from the MVP's FT-3; document immutability on re-render; Playwright: the MVP's e2e-smoke and e2e-bills journeys ported (sign-in via switcher), 360px and 1280px.

Done when: both ported journeys pass; a bill made on the VM downloads as PDF/JPG in all four papers with logo and signature; one-engine test includes the form preview; review clean. STOP.
```

### Stage 6 — Handwritten and photographed bill → clean bill

```
Stage 6: an owner photographs a handwritten kaccha bill (or an old printed one) and gets a correct, clean draft to check and make. Model output is staging only (I6).

Data model: uploads (business_id, sha256, mime, bytes or document_files ref, width/height, kind photo|pdf, created_by), extractions (business_id, upload_id, model, prompt_version, docling_used bool, result jsonb {customer{name,phone,gstin}, date, lines[{what, qty, unit, rate, amount, hsn?}], totals{subtotal, tax, grand}, notes}, confidence jsonb per field 0–1, warnings[], cost, latency, status pending|reviewed|committed|discarded, committed_document_id), extraction_corrections (extraction_id, field path, model_value, human_value, at) — the evaluation signal.

Pipeline (worker job read-bill): 1) normalise the image (rotate by EXIF, downscale to ≤ 2000 px, JPEG q85); 2) Docling OCR for printed input or as a hint; 3) packages/ai call with the vision model: the image + the Docling text + the business's items master names + the customer list names, prompt prompts/read-bill/v1.md asking for the JSON schema above with per-field confidence and "unreadable" allowed; 4) engine validation: numbers parse, qty×rate≈amount (flag otherwise), totals re-computed by computeTax never trusted from the image, dates plausible, customer matched by the matcher with the match score; 5) write the extraction; never a document.

Review screen (/bills/from-photo/[id]): the photo beside the draft; every field shows its confidence as colour (green ≥ 0.85, amber, red) and is editable; "unreadable" fields are empty and highlighted; totals are the engine's, with a note when they differ from what was written; "Bill banao" creates a draft document from the reviewed values (then Stage 5's path); corrections are recorded in extraction_corrections. Voice and the guide ring work here as on any screen (Stage 8 wires them).

Evaluation (packages/ai/eval): a fixture set of ≥ 30 photographed handwritten and printed bills in tests/fixtures/bills/ (the operator provides real ones in the report's questions; until then the agent draws synthetic ones with handwriting fonts and photographs them at angles — say so) with expected JSON; npm run eval:read-bill reports field accuracy, line recall, total-match rate, and abstention rate separately (correct "unreadable" is not a failure); results go in docs/stages/stage-6-report.md and the prompt version is bumped when changed.

Tests required: image normalisation; schema validation of model output (malformed → error row, never a crash); the engine never trusts image totals (test with a wrong total); roles (staff may upload and review; commit creates a draft under their id); Playwright: upload a fixture photo, see the draft with confidences, correct one field, make the bill, see the correction row.

Done when: eval numbers recorded (accuracy and abstention separately), I6 cited to the trigger and the commit path, cost per read recorded from ai_calls, review clean. STOP.
```

### Stage 7 — GST compliance and intelligence

```
Stage 7: the GST tab, the per-bill intelligence, and the workflow that keeps the rules current. Nothing files anything; everything explains itself.

GST workings (engine Stage 2 + a service): /gst for a registered business: period picker (month or quarter under QRMP), GSTR-1 tables (B2B, B2C large/small, CDNR, exports none, HSN summary at the business's digit requirement), 3B outward liability figures, totals reconcile to the documents list (drill-down from any figure to the documents behind it — port the MVP's GSTR-1 drill-down tests). Export: the CA pack (xlsx with the tables + every PDF, zipped) and a GSTR-1 JSON in the portal's offline-tool schema version noted in the rule pack (readiness for upload; the app does not upload).

Per-bill intelligence (engine assess() + copy): on the bill form and at issue time, plain-Hinglish checks with the rule id and a "why" from rules.explain(): place of supply decided or asked; customer GSTIN state vs place of supply; HSN digits required for this business's turnover band; B2C over ₹50,000 needs recipient address; composition legend; e-invoice applicability (threshold band from the declared turnover; if applicable, the bill shows "IRN required" and an IRN field the owner fills after generating it elsewhere; the document prints the IRN and QR when present); 30-day IRN reporting warning for the ≥ ₹10 crore band; credit note date limit; rate changed on this date (a bill dated across a rate change uses the date's rates and says so); reverse charge flag prints the legend and charges no tax; nil/exempt lines on a tax invoice vs bill of supply.

Rule-update workflow: npm run rules:update opens a checklist of every rule-pack entry with its source URL and verifiedOn; the agent (or the operator) re-reads each source, updates values and effectiveFrom, bumps the pack version, adds a fixture; a document's snapshot records the pack version used so old bills are explained by the rules of their day. docs/GST-RULES.md is generated from the pack (table per file, with sources) for the CA to read.

Intelligence for the owner (packages/ai, text model, staging-only answers): "GST samjhao" on any check: a two-sentence Hinglish explanation grounded ONLY in rules.explain() text passed to the model (the model rewrites, it does not decide); logged in ai_calls; cached per rule id and pack version.

Tests required: workings fixtures hand-computed for a quarter with mixed rates, inter-state, a credit note and a cancelled bill; drill-down totals equal the sum of their documents (generated test over the fixture set); each intelligence check has a unit test with a passing and a failing bill; export xlsx opens and its totals equal the workings (parse it back); GSTR-1 JSON validates against the schema file committed in rules/; Playwright: a registered business sees the GST tab, opens a quarter, drills into B2B, downloads the pack.

Done when: every rule entry has verifiedOn within this stage or is listed as unverified with reason; workings tests green; GST-RULES.md generated without diff; review clean. STOP.
```

### Stage 8 — The front desk

```
Stage 8: the whole owner-facing app, Hinglish, with roles, invites, voice, the guide ring and Poocho. Port the MVP's screens and journeys; change nothing permanent.

Screens: Home as reception (greeting by name, "Haan ji, kaise help karein aapki?", task cards: naya bill, bheje hue bills, kiske paise aane hain, bolke batana, kuch poochna, photo se bill; customer directory; staff see the same minus settings; accountants see bills, dues, GST and exports only), tabs Ghar/Bills/Customers/(GST)/Aap, /ask (Poocho, hybrid search + grounded answer, salvage), /bills/help (contract billing helper, salvage), invites (/you/team: owner invites by phone with a role; the invitee signs in with that phone and lands in the business; remove; change role), the dev switcher stays behind AUTH_MODE.

Voice (salvage VoiceProvider, session route, tools; adapt to v2 actions): starts on arrival for an opted-in owner, screen descriptions, show/fill/tap, owner-only buttons never pressed by voice, the setup walk-through, the from-photo review walk-through ("yeh field laal hai, kya likha tha?").

Guide ring (salvage GuideProvider, tours): a tour per screen including the new ones (items, team, from-photo, GST intelligence).

Copy: every string through packages/copy; the MVP's dictionary ported with its tests; new keys for every new screen.

Flow audit: port scripts/e2e-flow.mjs (every screen as a new owner, as staff, as accountant, and as the demo business; in by the button, out by the back arrow; no sideways scroll; a way out; tap sizes; no junk text; no English leftovers) and make it green.

Tests required: all MVP journeys ported (smoke, signin→switcher, home, guide, help, ask, desktop, bills, flow) and green at 360px and 1280px; roles in the UI (staff cannot see Aap's settings; accountant sees no make bar) with Playwright; invite lifecycle integration test; voice unit tests (instructions, tools) salvaged.

Done when: every journey is green on the VM, the screen count in ARCHITECTURE.md matches the routes, review clean. STOP.
```

### Stage 9 — 500 businesses

```
Stage 9: make it hold 500 businesses on this VM, prove it, and turn on sign-in without locking anyone out.

Performance: indexes for every list and dues query (EXPLAIN ANALYZE in the report for the five slowest); p95 budgets: home 400 ms, bill form 300 ms, issue 800 ms, PDF 3 s, photo read 20 s (worker); connection pool sized; the worker's concurrency per job type; Next.js caching only for public assets (tenant data is never cached across requests).

Load (scripts/load/*.js, k6): seed 500 businesses × 40 customers × 300 bills (worker job, idempotent); scenarios: 50 concurrent owners making bills, 200 reading dues, 10 rendering PDFs, 5 photo reads; run on the VM against the running stack at off-hours; report p50/p95 per route against the budgets; fix and rerun until within budget or list the gap in KNOWN-GAPS with a cause.

Operations: /api/metrics (Prometheus text) with request latency by route, job queue depth and age, model cost per day, db pool; a log line budget (no PII in logs: phone numbers masked); nightly backup already runs — now the restore drill: restore last night's dump into a scratch database on the VM, run the integration suite against it, record the time; disk: image size budget (app image ≤ 1.5 GB), free-space.sh in cron weekly; rate limits in the app (per session: 60 writes/min; per IP on sign-in: 10/min) with Hinglish messages; health includes queue age and last backup age.

Sign-in: AUTH_MODE=otp: Firebase phone OTP (salvage signin screens and session minting), Firebase Admin credentials via workload identity or the VM service account (never a downloaded key), the switcher disabled in production; switching is done by changing one env var and re-running up.sh, and the report includes the exact rollback (set AUTH_MODE=switcher, up.sh) so the operator is never locked out; the Caddy gate stays until the operator says otherwise.

Tests required: load scripts run in CI's nightly job at 1/10 scale; restore drill scripted and tested; rate limit tests; OTP flow Playwright against the Auth emulator (as the MVP); metrics endpoint test.

Done when: k6 within budget at 500 tenants (numbers in the report), restore drill passed with the time, OTP on and off demonstrated with the commands, review clean. STOP.
```

### Stage 10 — Audit pack and handover

```
Stage 10: prepare everything an independent OpenAI-model audit needs to assess the code in every aspect, and hand over.

docs/audit/: README (how to run everything from a clean clone: setup, tests, journeys, load, the review script), THREAT-MODEL.md (assets, actors, trust boundaries, the deferred-security list with current state), DATA-MODEL.md (generated from Drizzle), FIELD-TRACE.md (generated), RULES.md (the GST rule pack with sources), TEST-INVENTORY.md (generated: every test file, what it protects, count), COVERAGE.md (vitest coverage summary; the uncovered list), REVIEWS.md (every stage review and its resolutions), KNOWN-GAPS.md (final), DEPENDENCIES.md (npm audit output, licences), PERFORMANCE.md (Stage 9 numbers), a prompt file AUDIT-PROMPT.md addressed to the auditor: scope (security, correctness, GST compliance against the rule pack, tenancy, data integrity, operability, code quality), the invariants to verify, where each is enforced, and the expected output format (findings with severity, file:line, reproduction, fix).

Repository: make v2 the default branch (ask the operator; it is a GitHub setting), tag v2.0.0-rc1, update README.md (what EkBill is, how to run, how to deploy on the VM), confirm the MVP tag mvp-final still resolves.

Done when: a fresh clone on a clean machine (document the commands; run them in a temporary directory on the VM) passes setup and the full test suite from the README alone; the audit pack is complete; the report lists what the operator should tell the auditor. STOP.
```

---

## 8. Reference data

### 8.1 What to salvage from the MVP (tag `mvp-final`), and what not to

Copy with tests and origin comments (rule 6):

| MVP path | Into | Note |
| --- | --- | --- |
| `src/lib/money/index.ts` | `packages/engine/money.ts` | Paise, formatting, words |
| `src/lib/gst/tax-engine.ts`, `ruleset.ts` | `packages/engine/tax.ts`, rule pack | Ruleset becomes JSON data |
| `src/lib/gst/gstin.ts`, `state-codes.ts` | `packages/engine/ids.ts`, `states.ts` | Checksum, PAN-in-GSTIN, states |
| `src/lib/gst/scenarios.ts` | `packages/engine/assess.ts` | Document kind, blockers in plain words |
| `src/server/repos/invoices.ts` (numbering, issuance shape) | `packages/engine/numbering.ts`, `issue.ts` | The "perfect" numbering; keep behaviour |
| `src/lib/domain/bill-guard.ts`, `bill-form.ts` | engine + form logic | Duplicates, oddities, per-line rates |
| `src/lib/domain/contract.ts` | `packages/engine/contract.ts` | Contract billing maths |
| `src/lib/gst-returns/workings.ts`, `export.ts`, `qrmp.ts` | `packages/engine/workings.ts` | Re-shaped to v2 snapshots |
| `src/lib/dates.ts` | `packages/engine/dates.ts` | Civil dates, IST, FY |
| `src/lib/copy/*` | `packages/copy` | Dictionary, messages, tests |
| `src/lib/domain/language-guess.ts`, `whatsapp.ts` | `packages/engine` | |
| `src/server/pdf/template.ts`, `render.ts`, `upi.ts`, `sample.ts` | `packages/render`, worker | Designs, papers, JPEG, UPI QR |
| `src/lib/import/*`, `src/server/import/*` | worker import job | CSV/XLSX/PDF/Docling reading and matching |
| `src/lib/search/*`, `src/server/search/*` | worker + engine | Hybrid search, Poocho |
| `src/lib/voice/*`, `src/components/voice/*`, `src/app/api/voice/*` | `apps/web/lib/voice`, route | Realtime, tools |
| `src/lib/guide/*`, `src/components/guide/*` | `apps/web/lib/guide` | Ring, tours |
| `src/components/*` screens, `src/app/globals.css` | `apps/web` | Reference for look and copy; rewritten against v2 data |
| `scripts/e2e-*.mjs` | `tests/e2e` | Ported journeys |
| `deploy/*`, `infra/gcp` | `deploy/`, `infra/` | Adapted; Terraform not re-applied in this build |
| `docs/gst-owner-guide.md`, `owner-guide.md` | `docs/` | Updated for v2 |

Do not copy: the jsonb document store (`src/server/db/docs.ts`), Firestore remnants, the settings page, anything under `src/app/(app)/settings`, the AUTH_BYPASS single test user (replaced by the switcher with roles), `tests/global-setup.ts` as is (rewrite for Drizzle).

### 8.2 GST rule pack — starting content (verify every line in Stage 2)

Everything below is the agent's starting point, with the status as of **13 October 2026** from secondary sources. Each entry must be checked against its official source (CBIC notifications at cbic-gst.gov.in, GSTN advisories at gst.gov.in, PIB releases) before `verifiedOn` is set. Where I could not confirm from an official document, it says so.

| File | Entry | Value to verify | Source to cite |
| --- | --- | --- | --- |
| rates.json | Slabs from 2025-09-22 ("GST 2.0", 56th Council) | 0%, 5%, 18%, 40% (demerit), plus special rates 0.25% and 3%; selectable for documents dated on/after 2025-09-22 | CBIC rate notifications of Sept 2025; PIB release of the 56th Council |
| rates.json | Slabs before 2025-09-22 | 0, 5, 12, 18, 28 (+0.25, 3); kept for documents dated earlier and for the MVP's old bills | Earlier CBIC schedules |
| rates.json | 57th Council, 2026-10-08 | Recommendations only, no rate change reported; compliance changes (IMS improvements, GSTR-1/1A/IFF/3B reconciliation, penalties) pending notification — add nothing until notified | PIB "Recommendations of the 57th Meeting of the GST Council" |
| document-types.json | Tax invoice mandatory fields | Rule 46 CGST Rules: supplier name/address/GSTIN; consecutive unique serial (≤16 chars, letters/digits/-//) per FY; date; recipient name/address/GSTIN if registered; HSN/SAC; description; quantity and unit; total value; taxable value; rate and amount of tax split CGST/SGST(UTGST)/IGST/cess; place of supply with state name for inter-state; delivery address if different; whether tax is payable on reverse charge; signature or digital signature (not required on an e-invoice) | CGST Rules 2017, Rule 46 |
| document-types.json | B2C recipient details | Unregistered recipient: name, address, state required when invoice value ≥ ₹50,000 (and on request below) | Rule 46(e)/(f) |
| document-types.json | Bill of supply | Composition dealers and exempt/nil supplies; no tax lines; composition legend "composition taxable person, not eligible to collect tax on supplies" | Rule 49; Sec 31(3)(c) |
| document-types.json | Credit / debit note | Sec 34: links the original invoice; credit note must be declared by 30 November following the FY end or the annual return date, whichever earlier; fields per Rule 53 | Sec 34, Rule 53 |
| document-types.json | Receipt voucher (advance) | Rule 50 — out of scope for issuing in v2; recorded so assess() can refuse "advance" with a plain reason | Rule 50 |
| hsn.json | HSN/SAC digits on invoices | Aggregate turnover ≤ ₹5 crore: 4 digits mandatory for B2B, optional for B2C; > ₹5 crore: 6 digits on all; services SAC 6 digits starting 99 | Notification 78/2020-Central Tax; GSTR-1 Table 12 advisories |
| e-invoice.json | Applicability | Aggregate turnover > ₹5 crore in any FY from 2017-18, from 2023-08-01; applies from the FY after the threshold is crossed; exempt: banks/NBFCs/insurers, GTA, passenger transport, cinema, SEZ units, government departments | Notification 10/2023-Central Tax and predecessors |
| e-invoice.json | 30-day reporting window | Turnover ≥ ₹10 crore: invoices/CN/DN must be reported to the IRP within 30 days of the document date, from 2025-04-01 (earlier ≥ ₹100 crore from 2023-11); one secondary source shows a 2026 date — resolve from the GSTN advisory | GSTN advisory on the 30-day limit |
| composition.json | Limits | Goods ₹1.5 crore (₹75 lakh special-category states); services ₹50 lakh; cannot collect tax; bill of supply with legend | Sec 10; Rule 7 |
| registration-thresholds.json | Hints only | Goods ₹40 lakh (₹20/10 lakh special category), services ₹20 lakh (₹10 lakh) — used to say "aapko registration lena pad sakta hai" when declared turnover crosses it, never to decide anything | Sec 22, Notification 10/2019 |
| place-of-supply.json | The cases this app supports | B2B: recipient's state (from GSTIN); B2C goods: delivery state = customer's state; B2C services: supplier's state unless the service is tied to a property or event (then ask); anything else → "ask the CA" blocker | Sec 10–12 IGST Act |
| returns-calendar.json | Due days | GSTR-1 11th (monthly) / 13th of the month after the quarter (QRMP, IFF optional 13th monthly); GSTR-3B 20th (monthly), 22nd/24th (QRMP by state); outward liability auto-populated in 3B non-editable from the July 2025 period (corrections via GSTR-1A); ITC (Table 4) hard-locking status unclear — mark unverified; returns cannot be filed after 3 years from due date | GSTN advisory 2025-06-07; Finance Act 2023 s.? (verify) |
| ims.json | Invoice Management System | Live since Oct 2024 for recipients to accept/reject/pending; supplier-side effect: a rejected invoice is visible to the supplier — v2 records nothing about it, but GST-RULES.md explains it for the CA | GSTN IMS advisories |
| e-way.json | E-way bill | ₹50,000 consignment threshold — OUT OF SCOPE; recorded so the intelligence layer can say "e-way bill alag se banana padega" on goods bills above it | Rule 138 |

**Numbers as data, with these rules in the engine, not in prompts.** The vision model and the text model never see or decide a rate; they read handwriting and rewrite explanations.

### 8.3 Roles

| Action | owner | staff | accountant |
| --- | --- | --- | --- |
| Set up / change business profile, series, look, signature, logo | ✓ | | |
| Invite / remove members | ✓ | | |
| Add / edit customers and items | ✓ | ✓ | |
| Make bills, read photos, issue | ✓ | ✓ | |
| Record money, reminders | ✓ | ✓ | |
| Cancel, credit note, debit note | ✓ | | |
| See bills, dues, GST workings; export CA pack | ✓ | ✓ (no export) | ✓ |
| Delete anything | nobody (archive only) | | |

### 8.4 Budgets

Page ≤ 200 KB JavaScript on the bill form; first paint ≤ 2 s on a throttled 3G profile in Playwright; app image ≤ 1.5 GB; model cost per handwritten bill ≤ ₹3 at current prices (recorded from `ai_calls`); backup ≤ 10 minutes; restore ≤ 15 minutes.

---

## 9. Definition of done

| Stage | Checks before STOP |
| --- | --- |
| 0 | ≥ 15 GB free; watcher green; CI green on the pushed commit; `/api/health` ok on the VM; review script proved on a stub and on this stage; `.env.example` complete; report lists write-access and `.env` questions |
| 1 | `tenancy.test.ts` and `roles.test.ts` generated and green; cross-tenant SQL returns 0 rows (query in report); audit trigger appends exactly one row per write; RLS blocks a connection without `app.business_id`; switcher journey green; FIELD-TRACE lists user/business fields |
| 2 | `rules:check` passes; unverified entries listed with reasons; engine unit tests ≥ MVP count for the same modules (numbers in report); concurrency test 1…50; immutability trigger refuses UPDATE; one-engine test on 20 fixtures; I2–I5 cited file:line |
| 3 | Setup journey with signature at 360px green; PAN/GSTIN consistency tests green; files ≤ limits; owner-only writes in roles test; sample preview shows logo + signature |
| 4 | MVP import fixtures reproduce the MVP's counts; items uniqueness; customers journey green |
| 5 | smoke and bills journeys green at 360/1280; four papers × two formats download with logo and signature; payment lifecycle test green; one-engine test includes the form preview |
| 6 | Eval: field accuracy, line recall, total-match and abstention reported separately on ≥ 30 fixtures; malformed model output → error row, no crash; commit path requires a tap (trigger cited); cost per read in report |
| 7 | Workings fixtures hand-checked; drill-down sums equal documents (generated test); every intelligence check has pass/fail tests; CA pack parses back to the workings; GSTR-1 JSON validates; GST-RULES.md regenerates without diff; rule pack fully verified or listed |
| 8 | All MVP journeys ported and green; flow audit green for owner, staff, accountant, demo; invite lifecycle test; route count = ARCHITECTURE screen count |
| 9 | k6 p95 within budgets at 500 tenants (table in report); restore drill time recorded and suite green on the restored copy; rate-limit tests; OTP journey green on the emulator; on/off commands and rollback in the report; metrics endpoint test |
| 10 | Fresh clone passes setup + full suite from README alone; `docs/audit/*` complete; `v2` default branch (or the ask recorded); tag `v2.0.0-rc1` |

Two honest numbers beat one composite: wherever a stage reports a rate (eval accuracy, load p95), it also reports what was attempted and what was correctly abstained from, so correct "I cannot read this" is never scored as failure.

---

## 10. Open questions for the operator (answer before Stage 0)

1. **Branch:** orphan branch `v2` in the same repository (section 4.1), or a new repository `Ergplan/ekbill`? Same repository is proposed.
2. **Write access from the VM:** the current deploy key is read-only. Allowed to run `gh auth login` on the VM with your GitHub account, or will you add a second deploy key with write access?
3. **Stopping the MVP on the VM:** Stage 0 keeps both running (v2 on port 8081, no Caddy) until you say the MVP can be stopped. Say when. Its data volume is kept either way.
4. **Real handwritten bills:** Stage 6's evaluation needs ≥ 30 real photos (any shop's kaccha bills, names can be fictional). Can you provide them, or should synthetic ones be used until you do?
5. **Reviewer model:** which OpenAI model should `review:stage` use (the newest reasoning model on your account is proposed)? It is set in `.env` as `OPENAI_REVIEW_MODEL`.
6. **Accountant exports:** is the CA pack (xlsx + PDFs + GSTR-1 JSON) enough for your accountants, or do they use a specific software's import format (Tally, ClearTax)?
7. **Composition businesses:** bill of supply only, no return workings (proposed). Agree?
8. **Section 4.3:** the deferred-security table is the whole list. Anything you want on earlier, or off longer?
