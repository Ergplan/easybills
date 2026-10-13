# EkBill v2 — master prompt

**Status: DRAFT 2 for review.** Updated with the operator's answers of 13 Oct 2026: new repository `Ergplan/ekbill`; `gh auth login` on the VM; the MVP is stopped in Stage 0; real kaccha bills will be provided; the reviewer is the OpenAI model the operator named; the CA pack is Excel workings + all PDFs + GSTR-1 JSON; security stays low throughout the build; composition businesses get a bill of supply only; the voice lights up the section it is talking about; **the screen flow is designed, prototyped and approved on a review screen before anything is wired**; the attached design pack sets the visual quality (colour, depth, texture, glass), while this prompt decides flow, buttons and text.

EkBill is a Hinglish billing app for small Indian businesses. The promise, in the owner's words: **bill ready, sent on WhatsApp, record updated — in seconds.** The MVP (tag `mvp-final` in `Ergplan/easybills`) proved the concept with one owner per business and ~2,200 tests. v2 rebuilds it to serve **500 businesses**, each with an owner, staff and an accountant; GST compliance that is current, auditable and updatable as data; a logo and a drawn signature on every bill; PAN and GSTIN captured and checked; a photographed handwritten bill turned into a clean, correct one; and a UI that looks like the design pack and never makes the owner think.

---

## 1. How to use this prompt

- This file is committed once to the new repository. After that it is read from disk; nothing is pasted twice.
- Sections 2–5 are copied verbatim into `CLAUDE.md`, so they are in context in every session.
- Each stage is one Claude Code session on the VM, inside `tmux`. The operator types one line:

  ```
  Run Stage N of docs/MASTER-PROMPT.md
  ```

- The agent works until the stage's definition of done (section 9) is met, writes `docs/stages/stage-N-report.md`, commits, pushes, and **stops**. It never starts the next stage's work.
- The operator reads the report, spot-checks one invariant by hand, answers the open questions in one numbered message (or in `docs/stages/stage-N-answers.md` for Stage 1, which has an approval gate), and types the next stage line.
- The build runs on the existing shared VM `tariff-order` (asia-south2-b). Nothing new is provisioned. Disk is the scarce resource; Stage 0 deals with it first, and the MVP's containers are stopped in Stage 0 (its data volume is kept).
- The final **OpenAI-model audit** reads the whole repository; Stage 11 prepares its pack. Every stage before that is reviewed by an OpenAI model too (rule 2.12).

**Before Stage 0, on the VM (once).** Three pastes, each safe to run twice. The first installs `gh` and signs in to GitHub as you (a code is shown; enter it at github.com/login/device on your own machine; nothing is pasted into chat):

```bash
(
set -e
command -v claude >/dev/null || { echo "Claude Code is not installed on this VM"; exit 1; }
command -v tmux >/dev/null || sudo apt-get install -y tmux
if ! command -v gh >/dev/null; then
  sudo mkdir -p -m 755 /etc/apt/keyrings
  wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  sudo apt-get update -y && sudo apt-get install -y gh
fi
echo "Next: gh auth login (a device code; enter it on your own machine)"
)
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
```

The second freezes the MVP and creates the new repository with this prompt and the design pack in it:

```bash
(
set -e
[ -d ~/easybills ] || { echo "~/easybills (the MVP checkout) is missing"; exit 1; }
cd ~/easybills && git fetch origin && git checkout -q claude/admiring-wright-5w8x4g && git pull -q
git tag -f mvp-final && git push -f origin mvp-final
gh repo view Ergplan/ekbill >/dev/null 2>&1 || gh repo create Ergplan/ekbill --private --description "EkBill v2: Hinglish GST billing for small Indian businesses"
[ -d ~/ekbill ] || gh repo clone Ergplan/ekbill ~/ekbill
cd ~/ekbill
git config user.name "EkBill build" && git config user.email "build@ekbill.local"
mkdir -p docs && cp ~/easybills/docs/MASTER-PROMPT.md docs/ && cp -r ~/easybills/design design
git add -A && git commit -qm "docs: master prompt and design pack" && git branch -M main && git push -u origin main
echo "Ready: ~/ekbill on main with docs/MASTER-PROMPT.md and design/."
)
```

The third starts the build:

```bash
tmux new -s build
cd ~/ekbill && claude
# inside Claude Code:  /login  (choose the subscription)   then   Run Stage 0 of docs/MASTER-PROMPT.md
```

To come back from any browser: Cloud Shell → `gcloud compute ssh tariff-order --zone asia-south2-b --project tariff-order-parsing` → `tmux attach -t build`.

---

## 2. Operating rules

These go into `CLAUDE.md` verbatim.

1. **Stage by stage.** Do only the current stage. If something from a later stage is needed to make this one work, build the smallest stub, name it in the report, and stop.
2. **Every stage ends** with: watcher green, the app running on the VM (`curl localhost:8080/api/health` returns ok), `docs/stages/stage-N-report.md` written, living documents updated, the independent review run (rule 12), commit pushed to `main`, then STOP with the report printed.
3. **Tests with the code, not after.** Unit tests for every rule, calculation and state transition. Integration tests for every server action and route handler against a real Postgres. One Playwright journey per stage at 390px and 1280px, in both themes. A test is named for the behaviour it protects.
4. **Read `.watch/status.json` before every commit.** Red blocks the commit. Never skip, `.todo`, or mark a test expected-failure to get green. If a test is wrong, fix the test and say so in the commit message.
5. **Small commits** after each working increment, conventional messages (`feat(bills): …`). Tag each stage start `stage-N-start`.
6. **The MVP is a read-only input.** `~/easybills` (tag `mvp-final`) is never imported at runtime and never edited. Code copied from it carries `// from mvp-final: <path>` and comes with its tests. Section 8.1 lists what is worth copying; the rest is rewritten.
7. **The design pack is the visual law, not the product spec.** `design/` (tokens, themes, fonts, components, textures, reference screens) decides how things look: every colour, radius, shadow, gradient, glass surface and type size comes from `design/tokens/themes.css` (`var(--eb-…)`); nothing is hard-coded; every screen renders in both themes (Narangi light, Harmony dark) and is compared with the reference PNGs for hierarchy and depth. **This prompt decides the screen flow, the buttons and the words.** Where `design/CLAUDE.md` or `design/README.md` states a product rule (what Home contains, which tabs exist, what a string says), section 8.0 of this document wins, and the flow approved in Stage 1 wins after that. New screens are built from `design/components.md`'s vocabulary and added to `design/screens/<theme>/` as generated PNG references so the pack grows with the app.
8. **One language per layer.** TypeScript everywhere. SQL in migrations and `*.sql` files only. The design pack's `tokens/build.py` is the one Python file and is run only to regenerate tokens.
9. **Every model call goes through `packages/ai`**: typed input and output (zod), a versioned prompt loaded from `packages/ai/prompts/<name>/v<N>.md`, a retry policy, a timeout, and one row in `ai_calls` per call (model, prompt version, tokens, latency, cost, business_id, outcome). No `fetch` to a model endpoint anywhere else.
10. **Keep the folder layout** (section 5). A new top-level folder is added to `docs/ARCHITECTURE.md` in the same commit that creates it. No `utils/`, `misc/`, `helpers/`, `temp/`, `old/`.
11. **Secrets by environment variable.** `.env` is gitignored and lives on the VM; `.env.example` lists every name with a one-line meaning. Production values come from Secret Manager through `deploy/vm/up.sh`, as in the MVP. Secrets never appear in chat, in a commit, in a log line or in an error message.
12. **Independent review before every stage report, from Stage 0 onward.** `npm run review:stage -- N` sends to the **OpenAI model** named by `OPENAI_REVIEW_MODEL` (a different family from the builder), in a fresh context with no access to this session, exactly three things: the stage diff (`git diff stage-N-start..HEAD`), `CLAUDE.md`, and the stage prompt. It answers a fixed checklist and nothing else: (a) every invariant upheld, citing file and line, or the violation; (b) every action and route added has a test; (c) every write to an authoritative table is audited; (d) generated documents regenerate without diff; (e) every screen touched renders in both themes from tokens only; (f) any claim in the draft stage report that the code does not support. Fix every finding and rerun until it reports **no new code defect**. Findings that cannot be resolved by code (by-design behaviour, statements a diff cannot prove, decisions pending from the operator) go in the report with a one-line rationale and do not block the stage.
13. **Security that is deferred is listed, not forgotten** (section 4.3). Do not add it early; do not drop it from the list.
14. **Living documents in the same commit** as the code that changes them (section 5.3).
15. **Simplicity wins ties.** The owner raises a bill a week to the same dozen people from a phone. When two designs tie, choose the one with fewer taps and fewer words; when correctness and simplicity conflict, correctness wins and the complexity is hidden behind a default, never removed.
16. **Hinglish on screen, English on the bill.** Every string the owner sees comes from `packages/copy` with `en` and `hi-Latn` forms; the printed document is English with Indian number formatting. No jargon in Hinglish (the MVP's copy tests enforce this; keep them).
17. **The voice lights up what it talks about.** Every section, field and button that voice or the guide can mention carries a `data-guide` id; when voice says it, the guide highlight (the theme's accent glow) moves to it and the spoken words appear in the caption. Voice never presses an owner-only button (make, send, save, pay, delete); it lights it up and asks.
18. **Shared VM discipline.** Never touch the tariff or fdre products: not their compose projects, containers, images, volumes (`tariff_pgdata` and friends), ports (3000, 5432, 5433, 8000), firewall rules, Terraform state (`tariff/dev`), or files outside `~/ekbill` and `~/easybills`. Never run `docker system prune` or `docker volume prune`. Compose project is always `-p ekbill`. Check free disk at the start of every session; below 8 GB, stop and run `deploy/vm/free-space.sh` before building.
19. **Rate limits.** Analyse sequentially; use file trees and greps, not whole-directory reads. On a 429, wait 60 seconds and resume.
20. **Rebuild images when dependencies change**, and check container health at the start of each session.
21. **Ask once, in writing.** Questions for the operator go at the end of the stage report, numbered. Do not stop mid-stage to ask unless an invariant would otherwise be violated.

---

## 3. Invariants

These hold in every stage and override anything else in this document. If a stage prompt conflicts with one, the invariant wins and the agent flags the conflict in the report.

**I1 — Tenancy is total.** Every table that holds business data has a `business_id` column, `NOT NULL`, with a foreign key. Every query runs through a repository function that takes a `TenantScope` (business id, acting user id, role, request id) as its first argument; there is no repository function without one. Postgres row-level security is enabled on every such table with a policy on `current_setting('app.business_id')`, set per transaction by `withTenant()`. `tests/integration/tenancy.test.ts` is generated from the repository module list: scope A sees and changes nothing of B.

**I2 — One writer for issued documents.** Only `packages/engine/issue.ts#issueDocument()` moves a document to `status = 'issued'`, allocates its number and writes its `issued_snapshot`. A Postgres trigger refuses any `UPDATE` to `number`, `issued_at`, `issued_snapshot`, `totals` or `lines` on a row whose status is `issued` or `cancelled`. Corrections are new documents (credit note, debit note, cancel-and-redo) that link back. Everything a customer sees (PDF, JPG, receipt, WhatsApp text, GST workings) is rendered from `issued_snapshot`, never from the live business or customer record.

**I3 — Numbers are gapless, per series, per financial year, and never reused.** Allocation happens inside the issuing transaction with `SELECT … FOR UPDATE` on the series row; a unique index on `(business_id, series_id, financial_year, number)` backs it. 50 concurrent `issueDocument()` calls on one series produce exactly 1…50. The MVP's numbering behaviour (prefix, zero padding, optional FY suffix, next number only goes up, FY rollover) is kept as is.

**I4 — Money and tax are deterministic, integer, and come from one engine.** Integer paise, integer basis points, rounding specified in `packages/engine/money.ts`. `packages/engine/tax.ts#computeTax()` is the only tax calculation; the bill form preview, the PDF, the receipt and the GST workings all read its output, and `tests/unit/one-engine.test.ts` asserts they agree on a fixture set. No model call, no floating point, no `Date.now()` inside the engine.

**I5 — GST rules are versioned data, not code.** Rates, selectable rates, document types and their mandatory fields, HSN digit requirements, e-invoice thresholds, composition limits, place-of-supply rules and return calendars live in `packages/engine/rules/gst/*.json`, each entry with `effectiveFrom`, `effectiveTo`, `source` (an official URL), `verifiedOn`, `verifiedBy`. The engine selects by document date; a document's snapshot records the pack version it was issued under. A rule change is a data change with a fixture test. `npm run rules:check` fails on an entry without a source or a verification date.

**I6 — Model output lands in staging only.** Anything a model produces (a bill read from a photo, a voice command, a suggested rate, an answer) is written to `extractions` or `ai_calls` with provenance (input hash, model, prompt version, per-field confidence) and becomes a bill, a customer or a setting only when a human taps the button that commits it. A trigger forbids inserts into authoritative tables when `current_setting('app.actor_kind') = 'model'`.

**I7 — Every authoritative write is audited and attributed.** `documents`, `payments`, `adjustments`, `customers`, `items`, `businesses`, `memberships`, `series` each have a trigger appending to `audit_events` (business_id, actor user id, actor kind, table, row id, action, before, after, request id, at). `audit_events` is append-only. Every request carries a request id that reaches the logs and the audit row.

**I8 — Roles are enforced at the repository, not the screen.** `TenantScope` carries the role; each repository write declares `allowedRoles`; `tests/integration/roles.test.ts` is generated from those declarations (section 8.3). The UI hides what a role cannot do; hiding is not the enforcement.

**I9 — The golden path is measured, and it stays short.** From Home, a bill for a known customer with last month's lines is issued and handed to WhatsApp in **≤ 4 taps**, and recording its payment later takes **≤ 2 taps**; `tests/e2e/golden-path.spec.ts` counts the taps and times the path (≤ 20 s on Playwright's throttled "Slow 3G / 4× CPU" profile from Home tap to the share sheet). A change that breaks either budget fails CI. Every screen has one primary action; a second primary on a screen is a design defect.

---

## 4. Locked decisions

Not reopened unless analysis of the MVP shows something materially better; then `docs/DECISIONS.md` records why.

### 4.1 Stack

| Area | Decision | Why |
| --- | --- | --- |
| Repository | New repository **`Ergplan/ekbill`**, branch `main`; the MVP stays in `Ergplan/easybills` at tag `mvp-final`, checked out read-only at `~/easybills` | A clean history for the audit; the MVP readable on disk |
| Layout | npm workspaces monorepo: `apps/web`, `apps/worker`, `packages/engine`, `packages/ai`, `packages/db`, `packages/copy`, `packages/render`, `packages/ui`, plus `design/` (the pack) | The engine stays pure and testable; UI primitives live in one place and are the only consumers of tokens |
| Language | TypeScript 5.x, strict, everywhere | One language per layer; the proven engine is TypeScript |
| Web app | Next.js 16 App Router, React 19, server actions for writes, route handlers for files and webhooks, standalone output | Works on phones and on the VM; SSR for slow Android browsers |
| UI | `packages/ui`: components built from `design/components.md` (HeroPanel/FolderPanel, ClientChip, BillRow, StatusPill, PrimaryCTA, WhatsAppButton, LineItemCard, TotalCard, ToneSegmented, MessagePreview, InvoicePaper, TabBar, TopBar, IconButton, AgeingIndicator, SuccessHeader, plus the new ones v2 needs); CSS with the pack's tokens; no Tailwind, no component library; both themes always | The pack's depth, textures and glass are the quality bar; a library cannot reproduce them |
| Themes | Narangi (light, default) and Harmony (dark); `profile.theme = narangi \| harmony \| system`; applied with `data-theme` on `<html>` | From the pack |
| Database | PostgreSQL 16 with pgvector, **relational columns**, not jsonb documents | 500 tenants need indexes, constraints, RLS and reporting |
| ORM and migrations | Drizzle ORM with `drizzle-kit` SQL migrations in `packages/db/migrations`; a drift check in the watcher and CI; triggers and RLS written by hand in the same migrations | Typed schema in code, plain SQL on disk |
| Background work | `apps/worker` with `pg-boss` (Postgres-backed queue): read-bill, render-document, index-search, reminders, backup-check | No Redis on a shared VM; jobs are rows, so they are auditable |
| Auth | Firebase Auth phone OTP for people (as the MVP), server-minted session cookie; **during the build** `AUTH_MODE=switcher` (section 4.3) | OTP is what these users have; the switcher keeps testing fast and never locks anyone out |
| Tenancy and roles | One business per tenant; memberships with role `owner`, `staff`, `accountant`; invite by phone | Section 3, I1 and I8 |
| Models | OpenAI through `packages/ai`: a vision-capable model for photographed bills, a text model for Poocho and GST explanations, Realtime for voice; model IDs by environment variable, defaults recorded in the decisions log | The account and key exist; the reviewer and auditor are OpenAI, the builder is not |
| Reviewer | `OPENAI_REVIEW_MODEL` = the model the operator named ("sol 6.1"); Stage 0 lists the account's models, confirms the exact ID, and records it in `docs/DECISIONS.md`; if the name does not resolve, the newest reasoning model on the account is used and the operator is told | Rule 12 |
| Printed-document OCR | docling-serve (existing container) for printed PDFs and scans; the vision model for handwriting, with Docling text as a hint | Docling is cheap and local; handwriting needs a model |
| PDF and images | Playwright Chromium in the app image: HTML template → PDF (A4/A5/80mm/58mm) and JPEG; the InvoicePaper is theme-independent (white paper, ink text, formal English) | Proven; one renderer for every format |
| Search / Poocho | Postgres full text + pgvector hybrid (MVP design), indexing in the worker | Local, no extra service |
| Voice | OpenAI Realtime over WebRTC, server-minted client secrets, tools that light up, fill and tap safe buttons, never commit (I6, rule 17) | MVP design, kept |
| Copy | `packages/copy`: one dictionary `{en, hi-Latn}` seeded from `design/copy/strings.json` and the MVP's dictionary, with the MVP's jargon and length tests | Rule 16 |
| Logs and metrics | `pino` JSON logs with request id and business id; `/api/health`; `/api/metrics` (Prometheus text) | Enough to run 500 businesses on one VM |
| Deployment | Docker Compose project `ekbill` on `tariff-order`: `db` (volume `ekbill_v2_pgdata`), `docling`, `app`, `worker`, `caddy`; one image for app and worker; the MVP's `deploy/vm/*.sh` adapted | Nothing new to provision |
| CI | GitHub Actions on push to `main`: the watcher's checks plus Playwright on a Postgres service; nightly: load at 1/10 scale and model evals | The watcher is for the agent; CI is for everyone |
| Testing | vitest (unit, integration), Playwright (journeys, visual diffs against the pack's PNGs, tap counts), k6 (load, Stage 10) | What the MVP used, plus load and visual |
| Accountant exports | Excel workings + every PDF, zipped; GSTR-1 JSON in the portal's offline-tool schema (readiness only; the app never uploads) | Operator's answer |
| Composition businesses | Bill of supply with the mandatory legend; no return workings; CMP-08 out of scope | Operator's answer |

### 4.2 Product scope for v2

Kept from the MVP: the front-desk home, one-question-at-a-time setup, three-field bill lines, "Pichle jaisa hi", WhatsApp share with PDF or photo, Kiske paise aane hain, Yaad dilao with tone and the customer's language, Likh lo, GST tab only when registered, the guide highlight, voice, Poocho, old-bill import, contract billing helper, bill designs and paper sizes, logo.

New in v2: the design pack's look in two themes; roles and invites; PAN and GSTIN capture with checksum and consistency checks for the business and for customers; a drawn signature on bills; photographed handwritten bill → clean bill; an items master with HSN/SAC and rates; multiple numbering series; credit and debit notes as first-class documents; GST workings (GSTR-1 tables, HSN summary, 3B figures) with rule-pack versioning; per-bill GST intelligence in plain Hinglish; e-invoice readiness; the CA pack; backups with a tested restore; metrics; load-tested for 500 businesses.

Out of scope for v2 (so nobody builds them by accident): filing on the GST portal; IRN generation through an IRP (readiness and the IRN field only); e-way bills; TDS/TCS under GST; composition returns; inventory; purchases and ITC; multi-currency; multi-GSTIN per business; payroll; a desktop-first layout (desktop is the phone layout centred with a side rail, as the MVP).

### 4.3 Security posture during the build (deferred, explicitly)

The operator's instruction: keep security low during development and testing so the VM is never locked or stopped.

| Deferred | Until | Meanwhile |
| --- | --- | --- |
| Phone OTP sign-in | Stage 10 | `AUTH_MODE=switcher`: `/dev/switch` lists seeded users (owner, staff, accountant of several businesses) and sets the session cookie. Roles and tenancy are still enforced (I1, I8). Stage 10 turns OTP on with a one-line rollback. |
| Rate limits, WAF, bot checks | Stage 10 (basic rate limits); WAF later | Caddy's basic-auth gate stays in front of the app, as the MVP |
| SSH restrictions, deny rules, IP allowlists | **Never in this build** | The firewall is not changed except the existing `ekbill-allow-web` rule. No deny rules, no IAP-only rules, no allowlists: these are what lock people out. |
| Secret rotation, KMS, DLP | Later | Secret Manager as today |
| Row-level security, audit log | **On from Stage 2** | Not deferred: a column and a policy now, a migration later |
| HTTPS | **On** | Caddy |
| Backups | **On from Stage 0** (nightly, verified non-empty); restore drill in Stage 10 | |

Data on the VM during the build is test data. Every stage report repeats: "Sign-in is switched off; do not put a real business's books here yet."

---

## 5. Folder layout, continuous testing, living documents

### 5.1 Layout

```
ekbill/
  design/                # the design pack, as delivered: tokens, themes, fonts, copy seed, fixtures, components.md, screens/
  apps/
    web/                 # Next.js: screens, server actions, route handlers; no business rules
      app/               #   routes
      screens/           #   one folder per screen: the component tree, its fixture states, its data-guide map
      actions/           #   server actions: validate input, call a service, return ActionResult
      lib/               #   browser-side helpers only (guide highlight, voice client, share)
    worker/              # pg-boss workers: read-bill, render-document, index-search, reminders, backup-check
  packages/
    ui/                  # components from design/components.md, tokens only, both themes; Storybook-free: a /kit route renders them all
    engine/              # pure TypeScript: money, tax, rules, assess, numbering, issue, workings, contract
      rules/gst/         #   the GST rule pack (JSON, versioned, sourced) + fixtures
    db/                  # Drizzle schema, migrations (SQL), repositories (TenantScope first), triggers, RLS
    ai/                  # the one model client: prompts/<name>/v<N>.md, typed calls, ai_calls, evaluation sets
    copy/                # the dictionary {en, hi-Latn} and its tests
    render/              # InvoicePaper HTML templates (designs, papers), shared by app and worker
  deploy/                # Dockerfile, docker-compose.yml, Caddyfile, vm/*.sh
  scripts/               # review-stage.mjs, seed.mjs, flow-map.mjs, load/*.js (k6)
  tests/
    unit/                # mirrors packages/*
    integration/         # against a real Postgres: repositories, actions, triggers, RLS, roles, tenancy
    e2e/                 # Playwright: journeys, golden-path tap counts, visual diffs, flow audit
    fixtures/            # bills, kaccha-bill photos, GST rule fixtures, expected PDFs
  docs/
    MASTER-PROMPT.md     # this file
    SCREEN-FLOW.md       # generated from the routes manifest: every screen, its taps, where they lead
    ARCHITECTURE.md      # living
    DECISIONS.md         # living, dated
    KNOWN-GAPS.md        # living
    FIELD-TRACE.md       # generated: every user-visible field → table.column → who may write it
    stages/              # stage-N-report.md, stage-N-review-k.md, stage-1-answers.md
    audit/               # Stage 11: the pack for the OpenAI audit
  .watch/                # watcher status.json and log (gitignored)
  CLAUDE.md              # sections 2–5 of this file, verbatim, followed by design/CLAUDE.md's "Always" and "Never" lists
```

### 5.2 Continuous testing

`npm run watch` starts beside the app in Stage 0 and stays running in a tmux window. On every save it runs, stopping at the first red: `eslint`, `prettier --check`, `tsc --noEmit` for every workspace, vitest unit tests for the changed package then the full unit suite, `drizzle-kit check` (schema vs migrations drift), `npm run rules:check`, `npm run tokens:check` (no hard-coded colours, radii or shadows outside `design/`: `grep -nE "#[0-9a-fA-F]{3,8}|rgba?\(|[0-9]+px" apps packages/ui` filtered to style files), `npm run trace:check`, `npm run flow:check` (SCREEN-FLOW.md regenerates without diff), and the integration suite when `packages/db` or `apps/web/actions` changed. It writes `.watch/status.json` (`{ ok, failed: [...], at }`) and `.watch/log`. Playwright, load and paid-model calls are `@slow`: run at the stage boundary and nightly in CI.

### 5.3 Living documents

- `docs/SCREEN-FLOW.md` (generated by `scripts/flow-map.mjs` from `apps/web/screens/*/manifest.ts`): every screen with its purpose in one line, its primary action, its other taps and where each leads, its fixture states, its `data-guide` ids, and the golden paths with tap counts. The `/flow` review screen renders the same data.
- `docs/ARCHITECTURE.md`: components, data model table (every table: purpose, who writes), the critical paths with real function names, the action and route surface with roles, deployment; "What changed in Stage N" appended each stage.
- `docs/DECISIONS.md`: dated entries: decision, options, why, who asked.
- `docs/KNOWN-GAPS.md`: what is knowingly incomplete, with the stage or condition that closes it.
- `docs/FIELD-TRACE.md`: generated from zod schemas and Drizzle tables; CI fails on drift or on a field with no owner.

---

## 6. Plan

Ordered so that the screen flow is settled first (it is what the owner meets), then what is hardest to change (data, engine), then the wiring.

| Stage | Name | Creates | Stop point |
| --- | --- | --- | --- |
| 0 | Ground | Disk freed, MVP stopped, repo scaffold, `packages/ui` kit from the pack, watcher, review loop, CI, deploy | Kit renders in both themes on the VM; review ran |
| 1 | **Screen flow** | Every screen as a clickable prototype on fixtures, both themes; `/flow` review screen; voice highlight demo; golden-path tap counts | **Operator writes APPROVED in `docs/stages/stage-1-answers.md`**; nothing is wired before that |
| 2 | Identity, tenancy, roles, audit | Users, businesses, memberships, audit log, RLS, TenantScope, switcher | Generated tenancy and roles tests green |
| 3 | The engine | Money, tax, the GST rule pack, document types, numbering, issuance, workings | Engine ≥ MVP test parity; rule pack verified |
| 4 | Wire: profile and setup | PAN, GSTIN, logo, signature, bank/UPI, series, bill look, themes | Setup journey green with a signed, logo'd sample |
| 5 | Wire: customers and items | Customers, items with HSN/SAC, import | MVP import fixtures reproduce |
| 6 | Wire: bills, money, sharing | Documents, payments, adjustments, rendering, WhatsApp, dues, reminders | Golden path green and within budget (I9) |
| 7 | Photo → bill | Uploads, extractions, review screen, evaluation on the operator's kaccha bills | Eval numbers recorded; nothing commits without a tap |
| 8 | GST compliance and intelligence | Workings, per-bill checks, e-invoice readiness, CA pack, rule-update workflow | Workings match hand-computed fixtures |
| 9 | Wire: the rest of the front desk | Invites, voice, guide, Poocho, contract helper, flow audit | Every journey green; flow audit green for every role |
| 10 | 500 businesses | Performance, load, backups drill, metrics, rate limits, OTP on | k6 within budget; restore drill passed; OTP on/off shown |
| 11 | Audit pack and handover | `docs/audit/*`, release tag | A fresh clone passes everything from the README alone |

---

## 7. Stage prompts

### Stage 0 — Ground

```
Stage 0: make the repository, the tooling, the UI kit and the review loop on the shared VM, without touching the other products. Build no product feature and no screen flow (that is Stage 1).

Disk and the MVP. Run df -h /. Stop the MVP now, as the operator decided: cd ~/easybills && docker compose -p ekbill -f deploy/docker-compose.yml down (this keeps its volume ekbill_pgdata; never pass -v). Then ~/easybills/deploy/vm/free-space.sh. Record free space before and after. Do not build images until 15 GB is free; if it is not, list what docker system df shows for the OTHER projects without touching them and ask the operator in the report.

Repository. You are in ~/ekbill on main with docs/MASTER-PROMPT.md and design/. Create the layout in section 5.1: npm workspaces, TypeScript strict, eslint + prettier, vitest, Playwright (playwright-core with the VM's Chromium at PLAYWRIGHT_CHROMIUM_PATH, as the MVP), Drizzle with an empty schema and a first migration creating schema_migrations and the extensions (pgvector, pgcrypto). Write CLAUDE.md as sections 2–5 verbatim followed by the "Always" and "Never" lists from design/CLAUDE.md with one line above them: "Where these conflict with sections 2–5 or section 8.0 of docs/MASTER-PROMPT.md on flow, tabs or text, the master prompt wins." Write .env.example with every name the stages will need (DATABASE_URL, AUTH_MODE, SESSION_SECRET, OPENAI_API_KEY, OPENAI_REVIEW_API_KEY, OPENAI_REVIEW_MODEL, OPENAI_VISION_MODEL, OPENAI_TEXT_MODEL, OPENAI_REALTIME_MODEL, DOCLING_URL, DOCLING_API_KEY, EKBILL_DOMAIN, FIREBASE_*) and ask the operator to fill .env on the VM (nano .env in a second tmux window: Ctrl+B then C).

Reviewer model. With OPENAI_REVIEW_API_KEY present, list the account's models; find the one the operator named ("sol 6.1"); record the exact ID in docs/DECISIONS.md and .env.example's comment. If it does not resolve, use the newest reasoning model on the account and say so in the report.

UI kit (packages/ui). From design/: copy tokens/themes.css, tokens/fonts.css and fonts/ into the app's static assets (never Google Fonts at runtime); build every component in design/components.md as a React component with tokens only, both themes, 390px first; a /kit route renders them all with the pack's demo fixtures (design/fixtures/demo.json) and a theme switch. Add a Playwright visual test: /kit in both themes screenshotted and compared with design/screens/<theme>/00-kit.png at a tolerance recorded in the test; the first run stores the baseline and the report shows the diff images. npm run tokens:check as in 5.2.

Watcher, review loop, CI. scripts/watch.mjs (5.2); scripts/review-stage.mjs (rule 12; the stage prompt is the fenced block for stage N from docs/MASTER-PROMPT.md); npm run review:stage -- N; prove it on this stage. .github/workflows/ci.yml with a Postgres service.

Deployment. deploy/: Dockerfile (one image, two commands), docker-compose.yml (db with volume ekbill_v2_pgdata, docling, app on 127.0.0.1:8080, worker, caddy on 80/443), Caddyfile, vm/{lib,up,backup,restore,free-space,set-openai-key}.sh adapted from ~/easybills/deploy (keep the Secret Manager flow, -p ekbill, the gate password). Bring v2 up: https://<the VM's sslip.io name>/api/health returns ok with an empty schema; /kit is reachable behind the gate.

Living documents: ARCHITECTURE.md (layout, empty data model, the kit), DECISIONS.md (the stack table as dated entries; the reviewer model), KNOWN-GAPS.md, FIELD-TRACE.md and SCREEN-FLOW.md generated empty, docs/stages/stage-0-report.md.

Tests required: the watcher goes red on a deliberately failing test and green when it is removed (in the report, not committed red); review-stage.mjs unit test with a stubbed model; health route integration test; /kit visual test in both themes; tokens:check passes on the kit.

Done when: ≥ 15 GB free; MVP containers down and its volume listed as kept; watcher green; CI green; /api/health and /kit on the VM; review ran and findings fixed or listed; the report lists the operator's questions (.env values, anything about the model name). STOP.
```

### Stage 1 — Screen flow (approval gate)

```
Stage 1: design the whole app as screens an owner can tap through, on fixtures, with no database and no server logic, in both themes, and put it in front of the operator on a review screen. Nothing is wired until the operator approves. Think about simplicity before anything else: bill ready, sent, record updated — in seconds.

Inputs: section 8.0 (flow, buttons, words: this prompt decides), design/ (how it looks: tokens, depth, textures, glass, type; the reference PNGs set the quality bar), packages/ui from Stage 0, design/fixtures/demo.json extended in tests/fixtures/v2.json with: a brand-new owner (nothing yet), the demo business (Sharma Electricals, 12 customers, bills in every state, a credit note, a cancelled bill, two series), a staff member and an accountant of the demo business, three items, one photographed bill in review, one bill with GST checks pending, one composition business.

Screens to build (every one in both themes, 390px first, as apps/web/screens/<name>/ with a manifest.ts: route, purpose, primary action, taps → destination, fixture states, data-guide ids, role visibility):
  welcome/login, setup (one question per screen: name, PAN, GST hai?, GSTIN + e-invoice question when applicable, UPI, place, signature pad, review), home, bill-start (kiska bill: chips, search, naya customer, photo se), bill (form: pichle jaisa hi, line items with per-line GST when chosen, GST lagega? for registered, items suggestions, the intelligence strip, sticky make bar), bill-done (success, WhatsApp as PDF or photo, other sizes), bill-view (sent bill: status, paise aa gaye, yaad dilao, galti ho gayi → cancel/credit note), bill-from-photo (photo beside the draft, confidence colours, corrections), remind, bills (list with filters by state and series), customers, customer, customer-new, items, item, dues (kiske paise aane hain), gst (period, workings, drill-down, CA pack), you (aap: dukaan, PAN & GST, paise kaise dein, series, bill kaisa dikhe with logo and signature, theme, language, team), team (invite, roles), ask (poocho), help (contract helper entry), dev/switch, kit, flow.

Behaviour in the prototype: navigation is real (Next.js routes), state lives in the URL and sessionStorage, forms validate with the engine's pure checks where they already exist in the MVP (GSTIN, PAN, money parsing: copy those pure functions now with origin comments), "Bill banao" produces the done screen with a rendered InvoicePaper from the fixture, nothing persists. Role views: the same routes with ?as=staff / ?as=accountant hide what section 8.3 forbids.

The voice highlight (rule 17): the guide highlight component (accent glow ring + caption bubble, from the MVP's GuideProvider idea, restyled with tokens) and a "Tour" button on every screen that walks its data-guide ids in order with the spoken Hinglish text as caption; a "Bolke" button that, when OPENAI_API_KEY is present, opens a real Realtime session whose only tools are show/fill/tap on the prototype (port the MVP's voice tools and screen description; commits are refused with "prototype"); without a key, the tour alone.

The review screen (/flow): the screen map as a tappable graph (every screen a card with its thumbnail in the current theme; arrows labelled with the tap that leads there), the golden paths with tap counts measured by Playwright, the role matrix, the list of open questions for the operator, and a "walk it" mode that opens the prototype at the start of each golden path on a phone. Deployed on the VM behind the gate; the report gives the URL.

Golden paths and budgets (I9), measured in tests/e2e/golden-path.spec.ts on the prototype: (a) Home → chip → "Haan, wahi bharo" → Bill banao → WhatsApp: ≤ 4 taps; (b) Home → dues row → Paise aa gaye → Poore: ≤ 3 taps from Home; (c) Home → Photo se → shutter → review → Bill banao: ≤ 5 taps plus the shutter; (d) a brand-new owner from welcome to first bill sent: ≤ 12 taps including typing. Report the counts; redesign until within budget.

Visual tests: every screen screenshotted in both themes at 390px and stored under tests/e2e/__screenshots__; the nine screens that have reference PNGs in design/screens are compared with them (hierarchy, depth, spacing) and the diff images attached to the report; the new screens are copied into design/screens/<theme>/ as references.

Tests required: manifest completeness (every route has a manifest, every manifest tap resolves to a route, every screen has exactly one primary action, every data-guide id in a manifest exists in the DOM, every role-hidden element is absent for that role); golden-path tap counts; visual snapshots; tokens:check; flow:check (SCREEN-FLOW.md regenerates).

Done when: every screen above exists in both themes, /flow is live on the VM, SCREEN-FLOW.md is generated, tap counts are within budget, the report lists open design questions for the operator (numbered, each with a proposed answer), review clean. STOP and wait. The operator writes answers and the word APPROVED in docs/stages/stage-1-answers.md; "Run Stage 1 again" applies the answers and repeats until APPROVED is present. No stage after 1 may start without it.
```

### Stage 2 — Identity, tenancy, roles, audit

```
Stage 2: the people, the businesses, who may do what, and the audit trail. Wire the switcher and the shell; wire no other screen.

Data model (packages/db/schema, one migration):
- users: id uuid, phone_e164 unique, name, theme (narangi|harmony|system), language (hi-Latn|en), created_at, last_seen_at.
- businesses: id, legal_name, trade_name, status, created_at, updated_at, created_by (profile fields come in Stage 4).
- memberships: business_id, user_id, role (owner|staff|accountant), status (invited|active|removed), invited_by, invited_at, accepted_at; unique (business_id, user_id); exactly one active owner per business (partial unique index).
- audit_events (I7), append-only. sessions (user_id, business_id, role snapshot, expires_at). 
- packages/db/tenancy.sql: the helper that applies RLS + the audit trigger + the model-actor refusal (I6) to a table, so later stages call it.

Services: packages/db/scope.ts (TenantScope, withTenant); repos for users, businesses, memberships with allowedRoles on every write; apps/web/lib/auth (AUTH_MODE=switcher → /dev/switch; otp → 501 until Stage 10); request id middleware; pino with request id and business id; scripts/seed.mjs (three businesses with owner+staff+accountant, deterministic ids; the demo business of the fixtures).

Interface: the shell (TabBar, TopBar, theme and language from the user), /dev/switch, /you placeholder showing who you are and your role (the approved Stage 1 screen, read-only data).

Tests required: tenancy.test.ts generated from the repository module list (I1); roles.test.ts generated from allowedRoles (I8); audit trigger appends exactly one row per write with before/after; RLS blocks a raw connection with no app.business_id; model-actor insert refused; session test; Playwright: switch to owner of A, see A; switch to staff of B, see B; theme persists per user.

Done when: generated tests green; cross-tenant SQL returns 0 rows (query in the report); ARCHITECTURE.md has the data model table; FIELD-TRACE lists user and business fields; review clean. STOP.
```

### Stage 3 — The engine

```
Stage 3: packages/engine, pure and complete, plus the document tables it writes through issueDocument(). No screens are wired.

Salvage (rule 6, section 8.1) from ~/easybills with origin comments and tests: money, tax-engine (+ ruleset becomes JSON), gstin and state-codes, scenarios → assess, numbering and issuance shape, bill-guard and bill-form logic, contract, gst-returns workings/export/qrmp, dates. Re-shape to v2 types; keep every test passing (adapt names, not behaviour); list dropped tests with reasons.

Rule pack (I5): packages/engine/rules/gst/ with a zod schema and the files in section 8.2: rates.json, document-types.json, hsn.json, e-invoice.json, composition.json, place-of-supply.json, returns-calendar.json, registration-thresholds.json, credit-note-limits.json, ims.json, e-way.json. VERIFY EACH ENTRY against its official source before setting verifiedOn; unreachable → verifiedBy "unverified" and listed in the report. npm run rules:check.

Modules: money.ts; rules.ts (load, select by date, explain(ruleId) → {en, hi-Latn}); tax.ts computeTax (per-line rates, inclusive/exclusive, inter/intra, cess by rate, rounding, rule ids used); assess.ts assessDocument (kind, title, blockers in Hinglish with what-you-can-do, notices, rule ids: GSTIN when charging tax, place of supply known, HSN digits by turnover band, B2C ≥ ₹50,000 recipient details, composition legend, e-invoice applicability, 30-day IRN band, credit-note date limit, reverse charge, nil/exempt on the wrong document); numbering.ts; issue.ts issueDocument (I2, I3: FOR UPDATE, assess, computeTax, allocate, snapshot with pack version and rule ids and logo/signature refs, audit), cancel, creditNote, debitNote; workings.ts (GSTR-1 B2B, B2C large/small, CDNR, HSN summary; 3B outward; by period; from snapshots only).

Data model: series, documents (as Stage-2 draft of this document described: status draft|issued|cancelled, number, financial_year, dates, customer snapshot columns, place of supply, flags, lines jsonb for drafts, totals, issued_snapshot jsonb, linked_document_id, cancellation, revision), the immutability trigger, audit, RLS.

Tests required: all salvaged tests green; a fixture per rule entry (dated inside and outside its window); tax fixtures including mixed rates, inclusive pricing, inter-state, rounding; one-engine.test.ts on 20 fixtures (I4); numbering concurrency 1…50 (I3); issuance integration (draft→issued, blockers refuse, cancel, credit note links, immutability refuses UPDATE, audit rows); workings fixtures hand-computed with the arithmetic in a comment.

Done when: rules:check passes with zero unverified entries or the list with reasons; engine unit tests ≥ the MVP's count for the same modules; I2–I5 cited file:line; review clean. STOP.
```

### Stage 4 — Wire: profile and setup

```
Stage 4: wire the approved setup and Aap screens to real data. Owner only for writes.

Data model: extend businesses (address, city, pincode, state_code, phone, email, pan, gstin, registration_type regular|composition|not-registered|not-sure, e_invoicing_applies nullable, declared_turnover_band, bank fields, upi, default_payment_terms_days, bill design/paper/share-as/accent, logo_file_id, signature_file_id, default_series_id); business_files (kind logo|signature, bytes ≤ 300 KB, mime, sha256). Files stay in Postgres: nothing public, backed up with the database.

Checks (engine): PAN format; GSTIN checksum; PAN-inside-GSTIN equals the PAN field when both given; GSTIN state equals the chosen state; registration_type agrees with GSTIN presence; composition requires the legend; e_invoicing_applies answered when the turnover band requires it.

Signature pad: canvas, finger or stylus, "Phir se" and "Theek hai", trimmed transparent PNG ≤ 60 KB, stored as business_files kind=signature, printed on every document as the authorised signatory with "For <legal name>". Phone stays (it is the login); the signature is its own setup step and an Aap card.

Logo: the MVP's picker (shrink in browser) into business_files. Theme and language on the user (Stage 2) with the segmented controls from the approved screen.

Series: multiple numbering series per business (add, rename, retire, default); the numbering engine from Stage 3.

Tests required: PAN/GSTIN/consistency unit tests (including the MVP's); file limits; signature trimming on fixture strokes; roles regenerate (owner-only writes); Playwright: full setup with signature at 390px in both themes; Aap shows everything and Save works once; sample bill preview shows logo and signature.

Done when: setup end to end on the VM; FIELD-TRACE lists every profile field with owner-only write; review clean. STOP.
```

### Stage 5 — Wire: customers and items

```
Stage 5: who the bills go to and what is usually on them.

Data model: customers (name, contact_person, phone, email, address, city, pincode, state_code, gstin, pan, language, language_source, notes, archived, last_billed_at; unique (business_id, phone) when present), items (name, description, hsn_sac, unit, default_rate_paise, default_tax_bp, price_includes_tax, archived; unique (business_id, lower(name))), imports (staging for imported rows; I6: nothing lands without the owner ticking rows).

Services: customers repo (staff may create and edit, not delete), items repo, GSTIN → state/PAN derivation, language guess (salvage), import pipeline in the worker (CSV/XLSX, PDF text via pdfjs, Docling for scans, the salvaged matcher), "add karo" commits ticked rows; HSN/SAC lookup from packages/engine/rules/hsn-index.json (sourced).

Interface: the approved customers, customer, customer-new, items, item screens wired; Purane bills upload karo.

Tests required: repos + roles + tenancy regenerate; the MVP's import fixtures reproduce its results (1 customer from the PDF, 3 from the CSV, duplicates recognised); items uniqueness; Playwright: add a customer, import, tick two, see them.

Done when: import journey green; FIELD-TRACE updated; review clean. STOP.
```

### Stage 6 — Wire: bills, money, sharing

```
Stage 6: the reason the app exists. Wire the approved bill-start, bill, bill-done, bill-view, remind, bills and dues screens.

Services: startDocument (draft), the form (three fields, per-line GST when chosen, GST lagega? Haan/Nahi → bill of supply, items suggestions, Pichle jaisa hi, duplicate and rate-oddity guards, inline new-customer details, the intelligence strip from assess()); issue via issueDocument; rendering (packages/render + worker render-document: designs, papers, JPEG, logo and signature from the snapshot; document_files table; re-render on demand for another size; route serves bytes with the roles check); credit note / debit note / cancel-and-redo (owner only); payments (Likh lo full/part, Kam karo, reversal; balance = one function); dues; reminders with tone and the customer's language, reminders_sent, a worker job listing "due today" (no auto-sending); search index job.

Tests required: integration tests for every action with roles (staff makes bills and records money, cannot cancel or credit-note; accountant read-only); render tests (key strings; PDF page size per paper); payment lifecycle (issue → part → full → reversal → balance 0; the MVP's FT-3); immutability on re-render; Playwright: the MVP's smoke and bills journeys ported to the approved screens in both themes; golden paths (a) and (b) against real data within budget (I9).

Done when: both journeys green; four papers × two formats download with logo and signature; one-engine test includes the form preview; golden paths within budget on the VM; review clean. STOP.
```

### Stage 7 — Photo → bill

```
Stage 7: an owner photographs a handwritten kaccha bill (or an old printed one) and gets a correct, clean draft to check and make. Model output is staging only (I6). The operator provides the real photos: ask in the Stage 6 report for them to be placed in tests/fixtures/bills/real/ (gcloud compute scp from Cloud Shell, or a git commit from their machine); until they arrive, use synthetic ones and say so.

Data model: uploads, extractions (model, prompt_version, docling_used, result jsonb {customer, date, lines[{what, qty, unit, rate, amount, hsn?}], totals, notes}, confidence per field, warnings, cost, latency, status pending|reviewed|committed|discarded, committed_document_id), extraction_corrections (field path, model value, human value).

Pipeline (worker read-bill): normalise (EXIF rotate, ≤ 2000 px, JPEG q85) → Docling for printed input or as a hint → packages/ai vision call with the image, the Docling text, the business's item names and customer names, prompt prompts/read-bill/v1.md asking for the schema with per-field confidence and "unreadable" allowed → engine validation (numbers parse, qty×rate≈amount flagged, totals re-computed by computeTax and never trusted from the image, dates plausible, customer matched with a score) → extraction row. Never a document.

Review screen (approved in Stage 1): photo beside the draft; confidence as colour (≥ 0.85 green, amber, red); unreadable fields empty and lit; totals are the engine's with a note when they differ from what was written; Bill banao → Stage 6's draft path; corrections recorded. The voice walks it ("yeh wala laal hai, kya likha tha?").

Evaluation (packages/ai/eval): ≥ 30 photos with expected JSON; npm run eval:read-bill reports field accuracy, line recall, total-match rate and abstention rate separately; results in the report; bump the prompt version when changed.

Tests required: normalisation; schema validation (malformed → error row, never a crash); the engine never trusts image totals (fixture with a wrong total); roles (staff may upload and review); Playwright: upload a fixture, see confidences, correct a field, make the bill, see the correction row; golden path (c) within budget.

Done when: eval numbers recorded with abstention separate; I6 cited to the trigger and the commit path; cost per read from ai_calls; review clean. STOP.
```

### Stage 8 — GST compliance and intelligence

```
Stage 8: the GST tab, the per-bill intelligence, the CA pack, and the workflow that keeps the rules current. Nothing files anything; everything explains itself.

Workings (engine + a service): /gst for a registered business: period picker (month, or quarter under QRMP), GSTR-1 tables (B2B, B2C large/small, CDNR, HSN summary at the business's digit band), 3B outward figures; drill-down from any figure to the documents behind it (port the MVP's drill-down tests). CA pack: xlsx workings + every PDF, zipped; GSTR-1 JSON in the offline-tool schema committed in rules/ (readiness; never uploaded).

Per-bill intelligence: assess() checks on the bill form and at issue, in plain Hinglish with the rule id and a "kyun?" from rules.explain(): place of supply decided or asked; customer GSTIN state vs place of supply; HSN digits for the turnover band; B2C ≥ ₹50,000 recipient details; composition legend; e-invoice applicability (if applicable: "IRN required" and an IRN field the owner fills after generating it elsewhere; the document prints IRN and QR when present); 30-day IRN band warning; credit-note date limit; a bill dated across a rate change uses its date's rates and says so; reverse charge legend; nil/exempt lines on the wrong document.

Rule-update workflow: npm run rules:update lists every entry with source and verifiedOn; re-verify, update, bump the pack version, add a fixture; docs/GST-RULES.md generated from the pack for the CA.

"GST samjhao": a two-sentence Hinglish rewrite by the text model grounded ONLY in rules.explain() text (the model rewrites, never decides), logged, cached per rule id and pack version.

Tests required: workings fixtures hand-computed for a quarter with mixed rates, inter-state, a credit note and a cancelled bill; drill-down sums equal documents (generated); every check has pass and fail tests; the xlsx parses back to the workings; the JSON validates; Playwright: a registered business opens a quarter, drills into B2B, downloads the pack, sees a check on a bill and taps "kyun?".

Done when: every rule entry verified within this stage or listed; workings green; GST-RULES.md regenerates; review clean. STOP.
```

### Stage 9 — Wire: the rest of the front desk

```
Stage 9: everything else the approved flow has: invites and team, voice everywhere, the guide tour, Poocho, the contract helper, the flow audit. Change nothing permanent.

Invites: owner invites by phone with a role; the invitee signs in with that phone (switcher during the build) and lands in the business; remove; change role.
Voice (salvage and adapt): starts on arrival for an opted-in owner; screen descriptions from the manifests' data-guide maps; show/fill/tap; owner-only buttons lit, never pressed; the setup and photo-review walk-throughs.
Guide tour: per screen, from the manifests.
Poocho: hybrid search + grounded answer (salvage). Contract helper (salvage).
Copy: every string through packages/copy; the dictionary tests.
Flow audit (port scripts/e2e-flow.mjs): every screen as a new owner, as staff, as accountant and as the demo business; in by the button, out by the back arrow; no sideways scroll; a way out; tap sizes ≥ 44px; no junk text; no English leftovers; both themes.

Tests required: all MVP journeys ported and green in both themes; roles in the UI by Playwright; invite lifecycle integration; voice unit tests; golden path (d) within budget.

Done when: every journey green on the VM; flow audit green for every role and theme; route count = manifest count = SCREEN-FLOW.md; review clean. STOP.
```

### Stage 10 — 500 businesses

```
Stage 10: make it hold 500 businesses on this VM, prove it, and turn sign-in on without locking anyone out.

Performance: indexes for every list and dues query (EXPLAIN ANALYZE for the five slowest in the report); p95 budgets: home 400 ms, bill form 300 ms, issue 800 ms, PDF 3 s, photo read 20 s; pool sizing; worker concurrency per job; tenant data never cached across requests.
Load (k6): seed 500 businesses × 40 customers × 300 bills (idempotent worker job); scenarios: 50 owners making bills, 200 reading dues, 10 PDFs, 5 photo reads; run on the VM off-hours; p50/p95 per route against budgets; fix and rerun or list the gap with a cause.
Operations: /api/metrics; no PII in logs (phones masked); restore drill (last night's dump into a scratch database, integration suite against it, time recorded); image size ≤ 1.5 GB; weekly free-space.sh in cron; rate limits (60 writes/min per session; 10/min per IP on sign-in) with Hinglish messages; health includes queue age and last backup age.
Sign-in: AUTH_MODE=otp with Firebase phone OTP (salvage), Admin credentials via the VM's identity, never a downloaded key; the switcher disabled in production by the one env var; the report gives the exact rollback (AUTH_MODE=switcher, up.sh); the Caddy gate stays until the operator says otherwise.

Tests required: k6 at 1/10 in CI nightly; restore drill scripted; rate-limit tests; OTP journey on the Auth emulator; metrics endpoint test.

Done when: k6 within budget at 500 tenants; restore drill passed with time; OTP on and off demonstrated; review clean. STOP.
```

### Stage 11 — Audit pack and handover

```
Stage 11: prepare everything an independent OpenAI-model audit needs to assess the code in every aspect, and hand over.

docs/audit/: README (run everything from a clean clone), THREAT-MODEL.md (assets, actors, boundaries, the deferred-security list with current state), DATA-MODEL.md (generated), FIELD-TRACE.md, SCREEN-FLOW.md, RULES.md (the GST pack with sources), TEST-INVENTORY.md (generated), COVERAGE.md, REVIEWS.md (every stage review and resolution), KNOWN-GAPS.md, DEPENDENCIES.md (npm audit, licences incl. the Urbanist OFL), PERFORMANCE.md, AUDIT-PROMPT.md addressed to the auditor (scope: security, correctness, GST compliance against the rule pack, tenancy, data integrity, operability, code quality, UI against the design pack; the invariants and where each is enforced; the expected output: findings with severity, file:line, reproduction, fix).

Repository: tag v2.0.0-rc1; README.md (what EkBill is, run, deploy, the design pack); confirm mvp-final resolves in Ergplan/easybills.

Done when: a fresh clone in a temporary directory on the VM passes setup and the full suite from the README alone; the pack is complete; the report says what to tell the auditor. STOP.
```

---

## 8. Reference data

### 8.0 The screen flow this prompt decides (input to Stage 1)

The design pack is the quality bar for how it looks: the Narangi warmth and Harmony glass, the dot-grid ground, the folder with peeking bills, the 36px hero radius, the lavender money panel, Urbanist with tabular figures, 44px targets. Stage 1 builds to that bar. What follows is what the app *is*; Stage 1 turns it into screens, and the operator approves or changes it on `/flow`.

**Principle:** one screen asks one question; the primary action is where the thumb rests; the words are the owner's words. Nothing on Home that is not one of the three questions.

**Home (Ghar)** — Namaste by name; three cards: **Kiska bill?** (customer chips by recency, a search when more than eight, "Naya customer", "Photo se bill"), **Bheje hue bills** (count this month, three latest rows, "Saare dekho"), **Kiske paise aane hain** (total, oldest age, rows with "Yaad dilao"). The mic sits in the tab bar's centre, not on a card. Staff see the same; accountants see Bheje hue bills and Kiske paise aane hain only.

**Tab bar** — Ghar · Bills · [GST, only with a GSTIN] · Aap, with the mic as the floating centre action. Customers and items are reached from Home's chips and from Bills, not a tab.

**Kiska bill → Bill** — tap a chip → the form opens with "Pichle jaisa hi?" at the top when a previous bill exists ("Haan, wahi bharo" fills the lines); KAAM cards with Kya kiya / Kitna / Rate and the Rakam computed; "Aur kaam jodo"; for a registered business a quiet strip "GST: 18% sab pe · badlo" that opens Haan/Nahi, one rate or per-line; the intelligence strip appears only when a check fails ("Customer ka state chuno" with one tap); the sticky make bar "Bill banao · ₹6,200". New customer: the name field first, phone and GSTIN folded.

**Bill done** — tick, "Bill ban gaya!", the InvoicePaper preview (white, English), **WhatsApp pe bhejo** (green, the only green), PDF or Photo as a small toggle, "Doosra size", "Ghar", "Isi customer ka aur ek".

**Bill view (sent)** — amount due large, status pill, **Paise aa gaye** (then Poore / Kuch hissa, date, how), Yaad dilao, WhatsApp dobara, download, "Galti ho gayi?" folded (cancel karke naya, rakam kam karo = credit note).

**Yaad dilao** — tone segmented (Pyaar se / Seedha / Doosri baar), the message in the customer's language with the bill attached, "Bhasha badlo", **WhatsApp kholo**.

**Photo se bill** — camera or gallery → "Padh rahe hain…" → review: photo on top, the draft below with coloured confidence; tap a field to fix; "Bill banao".

**Bills** — list newest first, filter chips (Sab / Baaki / Aa gaye / Cancel), series chip when more than one, search.

**Customers / Customer** — directory with search; the customer folder: last three bills peeking, period total and due, timeline, "Inka bill banao"; details folded (phone, GSTIN, PAN, state, language, notes).

**Items** — reached from Aap and from the form's suggestions; name, HSN/SAC with lookup, unit, rate, GST rate.

**GST** — only with a GSTIN: period, two stat tiles (Bills, GST), rate split, B2B list, B2C note, drill-down, **CA ko bhejo**; a bill's checks are on the bill, not here.

**Aap** — dukaan (name, address, PAN, GST, state), paise kaise dein (UPI, bank folded), bill number series, bill kaisa dikhe (logo, signature, design, colour, paper, PDF/photo, sample), theme (Narangi/Harmony/System), language (Hinglish/English), team (owner only), app ki jaankari, one sticky Save.

**Setup (first time)** — "Namaste ji! Hum pehli baar mil rahe hain, to apne baare mein thoda bataiye please." then one question per screen: dukaan ka naam → PAN (skip allowed, asked again when GST is given) → GST number hai? → GSTIN (+ e-invoice question when the turnover band needs it) → UPI (skip) → sheher/rajya (prefilled from GSTIN) → signature (skip allowed, asked again before the first bill) → "Sab sahi hai?" with Badlo per row → "Chalo, shuru karte hain". The voice can lead it.

**Welcome/Login** — the pack's hero, phone, OTP; during the build `/dev/switch`.

### 8.1 What to salvage from the MVP (tag `mvp-final`), and what not to

| MVP path | Into | Note |
| --- | --- | --- |
| `src/lib/money/index.ts` | `packages/engine/money.ts` | Paise, formatting, words |
| `src/lib/gst/tax-engine.ts`, `ruleset.ts` | `packages/engine/tax.ts`, rule pack | Ruleset becomes JSON |
| `src/lib/gst/gstin.ts`, `state-codes.ts` | `packages/engine/ids.ts`, `states.ts` | |
| `src/lib/gst/scenarios.ts` | `packages/engine/assess.ts` | |
| `src/server/repos/invoices.ts` (numbering, issuance shape) | `packages/engine/numbering.ts`, `issue.ts` | Keep behaviour |
| `src/lib/domain/bill-guard.ts`, `bill-form.ts`, `contract.ts`, `language-guess.ts`, `whatsapp.ts` | `packages/engine` | |
| `src/lib/gst-returns/workings.ts`, `export.ts`, `qrmp.ts` | `packages/engine/workings.ts` | |
| `src/lib/dates.ts` | `packages/engine/dates.ts` | |
| `src/lib/copy/*` | `packages/copy` | Merged with `design/copy/strings.json`; tests kept |
| `src/server/pdf/*` | `packages/render`, worker | Designs, papers, JPEG, UPI QR |
| `src/lib/import/*`, `src/server/import/*`, `src/lib/search/*`, `src/server/search/*` | worker + engine | |
| `src/lib/voice/*`, `src/components/voice/*`, `src/app/api/voice/*`, `src/lib/guide/*`, `src/components/guide/*` | `apps/web/lib` | Restyled with tokens |
| `scripts/e2e-*.mjs` | `tests/e2e` | Ported journeys and the flow audit |
| `deploy/*` | `deploy/` | Adapted; `infra/gcp` not re-applied |
| `docs/gst-owner-guide.md`, `owner-guide.md` | `docs/` | Updated |

Do not copy: the jsonb document store, Firestore remnants, the old settings page, the MVP's CSS (the pack replaces it), the single-test-user AUTH_BYPASS (replaced by the switcher with roles), `tests/global-setup.ts` as is.

### 8.2 GST rule pack — starting content (verify every line in Stage 3)

Status as of 13 October 2026 from secondary sources; each entry must be checked against its official source before `verifiedOn` is set.

| File | Entry | Value to verify | Source to cite |
| --- | --- | --- | --- |
| rates.json | Slabs from 2025-09-22 (56th Council) | 0%, 5%, 18%, 40%, plus 0.25% and 3% special | CBIC rate notifications Sept 2025; PIB |
| rates.json | Slabs before 2025-09-22 | 0, 5, 12, 18, 28 (+0.25, 3) for earlier-dated documents | Earlier schedules |
| rates.json | 57th Council, 2026-10-08 | Recommendations only, no rate change; compliance changes pending notification — add nothing until notified | PIB "Recommendations of the 57th Meeting" |
| document-types.json | Tax invoice mandatory fields | Rule 46: supplier name/address/GSTIN; unique serial ≤16 chars per FY; date; recipient details, GSTIN if registered; HSN/SAC; description; qty+unit; total; taxable value; tax split CGST/SGST/IGST/cess; place of supply with state for inter-state; delivery address if different; reverse-charge indicator; signature (not on e-invoice) | CGST Rules, Rule 46 |
| document-types.json | B2C recipient details | Required when invoice value ≥ ₹50,000 to an unregistered recipient | Rule 46(e)/(f) |
| document-types.json | Bill of supply | Composition and exempt/nil; no tax lines; the composition legend | Rule 49; Sec 31(3)(c) |
| document-types.json | Credit / debit note | Sec 34; declare credit notes by 30 Nov after FY end or the annual return, whichever earlier; Rule 53 fields | Sec 34, Rule 53 |
| hsn.json | Digits on invoices | Turnover ≤ ₹5 crore: 4 digits B2B mandatory, B2C optional; > ₹5 crore: 6 digits; SAC 6 digits starting 99 | Notification 78/2020-CT |
| e-invoice.json | Applicability | Turnover > ₹5 crore in any FY from 2017-18, from 2023-08-01; sector exemptions | Notification 10/2023-CT |
| e-invoice.json | 30-day reporting | ≥ ₹10 crore from 2025-04-01 (one secondary source shows 2026 — resolve from the GSTN advisory) | GSTN advisory |
| composition.json | Limits and legend | Goods ₹1.5 crore (₹75 lakh special states); services ₹50 lakh; cannot collect tax | Sec 10; Rule 7 |
| registration-thresholds.json | Hints only | Goods ₹40 lakh, services ₹20 lakh (lower in special-category states) | Sec 22; Notification 10/2019 |
| place-of-supply.json | Supported cases | B2B: recipient's state; B2C goods: delivery state; B2C services: supplier's state unless tied to property/event → ask | IGST Act Sec 10–12 |
| returns-calendar.json | Due days and locks | GSTR-1 11th / QRMP 13th; 3B 20th (22nd/24th QRMP); 3B outward auto-population non-editable from July 2025 period (GSTR-1A for corrections); ITC Table 4 lock status unverified; 3-year filing limit | GSTN advisory 2025-06-07 |
| ims.json | Invoice Management System | Live since Oct 2024 for recipients; explained in GST-RULES.md, nothing computed | GSTN IMS advisories |
| e-way.json | E-way bill | ₹50,000 consignment threshold — out of scope; the intelligence says "e-way bill alag se banana padega" on goods bills above it | Rule 138 |

### 8.3 Roles

| Action | owner | staff | accountant |
| --- | --- | --- | --- |
| Business profile, series, look, signature, logo, theme | ✓ | | |
| Invite / remove members | ✓ | | |
| Add / edit customers and items | ✓ | ✓ | |
| Make bills, read photos, issue | ✓ | ✓ | |
| Record money, reminders | ✓ | ✓ | |
| Cancel, credit note, debit note | ✓ | | |
| See bills, dues, GST workings | ✓ | ✓ | ✓ |
| Export the CA pack | ✓ | | ✓ |
| Delete anything | nobody (archive only) | | |

### 8.4 Budgets

Golden paths per I9; page ≤ 200 KB JavaScript on the bill form; first paint ≤ 2 s on the throttled profile; both themes within the same budgets; app image ≤ 1.5 GB; model cost per photographed bill ≤ ₹3 (from `ai_calls`); backup ≤ 10 min; restore ≤ 15 min.

---

## 9. Definition of done

| Stage | Checks before STOP |
| --- | --- |
| 0 | ≥ 15 GB free; MVP down, volume kept; watcher and CI green; `/api/health` and `/kit` on the VM; kit visual test in both themes; tokens:check passes; review script proved; reviewer model ID recorded |
| 1 | Every screen in 8.0 exists in both themes at 390px; manifests complete and consistent; `/flow` live on the VM; SCREEN-FLOW.md regenerates; golden-path tap counts within I9; visual diffs against the nine reference PNGs attached; open questions numbered with proposals; **APPROVED written by the operator before Stage 2** |
| 2 | Generated tenancy and roles tests green; cross-tenant SQL 0 rows; audit trigger one row per write; RLS and model-actor refusals proven; switcher journey green; FIELD-TRACE has user/business fields |
| 3 | rules:check passes or unverified listed; engine tests ≥ MVP count; concurrency 1…50; immutability trigger refuses; one-engine on 20 fixtures; I2–I5 cited file:line |
| 4 | Setup journey with signature, both themes; PAN/GSTIN consistency tests; file limits; owner-only writes; sample shows logo + signature |
| 5 | MVP import fixtures reproduce; items uniqueness; customers journey green |
| 6 | Smoke and bills journeys green, both themes; four papers × two formats; payment lifecycle; one-engine includes the form; golden paths (a) and (b) within budget on real data |
| 7 | Eval numbers on the operator's photos (accuracy, recall, total-match, abstention separately); malformed output → error row; commit needs a tap; cost per read; golden path (c) |
| 8 | Workings fixtures hand-checked; drill-down sums; every check pass/fail tested; xlsx parses back; JSON validates; GST-RULES.md regenerates; pack verified or listed |
| 9 | All journeys green, both themes; flow audit green for owner, staff, accountant, demo; invite lifecycle; routes = manifests = SCREEN-FLOW; golden path (d) |
| 10 | k6 within budgets at 500 tenants; restore drill time; rate limits; OTP on/off with rollback; metrics test |
| 11 | Fresh clone passes from README alone; audit pack complete; tag `v2.0.0-rc1` |

Two honest numbers beat one composite: every rate is reported with what was attempted and what was correctly abstained from.

---

## 10. Decisions recorded from the operator (13 Oct 2026)

1. Repository: new, `Ergplan/ekbill`; MVP frozen at `mvp-final` in `Ergplan/easybills`.
2. GitHub access from the VM: `gh auth login` as the operator (section 1 shows it).
3. The MVP's containers are stopped in Stage 0; its data volume is kept.
4. Real kaccha bills will be provided for Stage 7's evaluation.
5. Reviewer: the OpenAI model the operator named ("sol 6.1"); Stage 0 confirms the exact ID.
6. CA pack: Excel workings + every PDF + GSTR-1 JSON.
7. Security stays low throughout the build (section 4.3); nothing that can lock the operator out.
8. Composition businesses: bill of supply only.
9. The voice lights up the section it talks about (rule 17, I9's one-primary-action rule).
10. The screen flow is designed and approved on `/flow` in Stage 1 before any wiring; the design pack sets visual quality, this prompt sets flow, buttons and text (rule 7, section 8.0).

**Still open (answer in the Stage 1 review, not before):** anything in section 8.0 you would change — Stage 1 exists to find that out on a phone, not in this document.
