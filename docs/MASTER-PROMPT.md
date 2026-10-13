# EkBill v2 — master prompt

**Status: DRAFT 3.** Draft 2 was reviewed by a fresh-context agent against the build-pattern template, the design pack and the operator's answers; its findings (contradictions, gaps, gameable checks, lock-out risks) are folded in. Section 10 lists the operator's decisions; section 11 lists what changed in this draft.

EkBill is a Hinglish billing app for small Indian businesses. The promise, in the owner's words: **bill ready, sent on WhatsApp, record updated — in seconds.** The MVP (tag `mvp-final` in `Ergplan/easybills`) proved the concept with one owner per business and ~2,200 tests. v2 rebuilds it to serve **500 businesses**, each with an owner, staff and an accountant; GST compliance that is current, auditable and updatable as data; a logo and a drawn signature on every bill; PAN and GSTIN captured and checked; a photographed handwritten bill turned into a clean, correct one; and a UI that looks like the design pack and never makes the owner think.

---

## 1. How to use this prompt

- This file lives in `Ergplan/ekbill` at `docs/MASTER-PROMPT.md`. Sections 2–5 are copied verbatim into `CLAUDE.md`, so they are in context in every session.
- Each stage is one Claude Code session on the VM, inside `tmux`. The operator types one line:

  ```
  Run Stage N of docs/MASTER-PROMPT.md
  ```

  Stage 2 is the one exception: its line is `Run Stage 2 of docs/MASTER-PROMPT.md — APPROVED`, typed by the operator only after the Stage 1 screen flow is approved. The agent records the line in the Stage 2 report; without the word it refuses to start.
- The agent works until the stage's definition of done (section 9) is met, writes `docs/stages/stage-N-report.md`, commits, pushes, and **stops**. It never starts the next stage's work.
- The operator reads the report, spot-checks one invariant by hand, and answers the open questions. For every stage but Stage 1 the answers are one numbered message; for Stage 1 they go in `docs/stages/stage-1-answers.md` (one channel, because Stage 1 repeats until approved).
- The build runs on the existing shared VM `tariff-order` (asia-south2-b). Nothing new is provisioned. Disk is the scarce resource. The MVP's containers are stopped before Stage 0 (paste 2 below); its data volume `ekbill_pgdata` is kept.
- The final **OpenAI-model audit** reads the whole repository; Stage 11 prepares its pack. Every stage before that is reviewed by an OpenAI model too (rule 2.12).

**Before Stage 0, on the VM (once).** Four pastes, each safe to run twice.

Paste 1 installs `gh` and signs in to GitHub as you. A device code is shown; enter it at github.com/login/device on your own machine. Nothing is pasted into chat.

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

Paste 2 freezes the MVP, stops its containers (volume kept), and clones the new repository, which already holds this prompt and the design pack:

```bash
(
set -e
[ -d ~/easybills ] || { echo "~/easybills (the MVP checkout) is missing"; exit 1; }
cd ~/easybills
git fetch origin
git tag -f mvp-final origin/claude/admiring-wright-5w8x4g && git push -f origin mvp-final
docker compose -p ekbill -f deploy/docker-compose.yml down   # stops the MVP; never -v: ekbill_pgdata stays
docker volume ls --format '{{.Name}}' | grep -qx ekbill_pgdata && echo "MVP volume ekbill_pgdata kept"
[ -d ~/ekbill ] || gh repo clone Ergplan/ekbill ~/ekbill
cd ~/ekbill && git pull -q
git config user.name "EkBill build" && git config user.email "build@ekbill.local"
df -h / | tail -1
echo "Ready: ~/ekbill on main."
)
```

Paste 3 writes `.env` with every name the build needs, then opens it for you to fill. Stage 0's review loop needs `OPENAI_REVIEW_API_KEY` and `OPENAI_REVIEW_MODEL` (the **exact** model ID from your OpenAI account, as the models list prints it); the app's own key goes in `OPENAI_API_KEY`. Keys are typed only here, never into chat.

```bash
(
set -e
cd ~/ekbill
[ -f .env ] || cat > .env <<'EOF'
# EkBill v2 on the VM. Filled by the operator; never committed. Production values also live in Secret Manager.
DATABASE_URL=postgres://ekbill:CHANGE_ME@127.0.0.1:5441/ekbill
AUTH_MODE=switcher
SESSION_SECRET=CHANGE_ME_32_RANDOM_CHARS
OPENAI_API_KEY=
OPENAI_REVIEW_API_KEY=
OPENAI_REVIEW_MODEL=
OPENAI_VISION_MODEL=
OPENAI_TEXT_MODEL=
OPENAI_REALTIME_MODEL=
DOCLING_URL=http://127.0.0.1:5001
DOCLING_API_KEY=
EKBILL_DOMAIN=
EOF
chmod 600 .env
echo "Fill the keys, save, then run paste 4."
)
nano ~/ekbill/.env
```

Paste 4 starts the build:

```bash
tmux new -s build
cd ~/ekbill && claude
# inside Claude Code:  /login  (choose the subscription)   then   Run Stage 0 of docs/MASTER-PROMPT.md
```

To come back from any browser: Cloud Shell → `gcloud compute ssh tariff-order --zone asia-south2-b --project tariff-order-parsing` → `tmux attach -t build`. A second window for editing `.env` later: Ctrl+B then C.

---

## 2. Operating rules

These go into `CLAUDE.md` verbatim.

1. **Stage by stage.** Do only the current stage. If something from a later stage is needed to make this one work, build the smallest stub, name it in the report, and stop.
2. **Every stage ends** with: watcher green, the app running on the VM (`curl localhost:8080/api/health` returns ok), the draft `docs/stages/stage-N-report.md` written and committed, living documents updated, the independent review run on that commit (rule 12), findings fixed, the final report committed and pushed to `main`, then STOP with the report printed.
3. **Tests with the code, not after.** Unit tests for every rule, calculation and state transition. Integration tests for every server action and route handler against a real Postgres. One Playwright journey per stage at 390px in both themes; the shell (tab bar, top bar, one list) also at 1280px. A test is named for the behaviour it protects.
4. **Read `.watch/status.json` before every commit.** Red blocks the commit. Never skip, `.todo`, or mark a test expected-failure to get green. If a test is wrong, fix the test and say so in the commit message.
5. **Small commits** after each working increment, conventional messages (`feat(bills): …`). Tag each stage start `stage-N-start`.
6. **The MVP is a read-only input.** `~/easybills` (tag `mvp-final`) is never imported at runtime and never edited. Code copied from it carries `// from mvp-final: <path>` and comes with its tests. Section 8.1 lists what is worth copying; the rest is rewritten.
7. **The design pack is the visual law, not the product spec.** `design/` decides how things look: every colour, radius, shadow, gradient, glass surface and type size comes from `design/tokens/themes.css` (`var(--eb-…)`), imported from the workspace, never copied; only the font files are copied into static assets at build. Every screen renders in both themes (Narangi light, Harmony dark) and is compared with the reference PNGs. **This prompt decides the screen flow, the buttons, the words, the product concepts and the guide highlight.** Where `design/CLAUDE.md` or `design/README.md` states a product rule (what Home contains, which tabs exist, what a string says, "no periods or returns", what the accent may be used for), section 8.0 of this document wins, and the flow approved in Stage 1 wins after that. A value the pack lacks (e.g. the guide highlight `--eb-guide`) is added to `design/tokens/tokens.json` and regenerated, never hard-coded. New screens are built from `design/components.md`'s vocabulary and added to `design/screens/<theme>/` as generated PNG references.
8. **One language per layer.** TypeScript for the app, worker, packages and tests. Scripts in `scripts/` may be `.mjs`; k6 load scripts are `.js`; `design/tokens/build.py` is the one Python file and is run only to regenerate tokens. SQL in migrations and `*.sql` files only.
9. **Every model call goes through `packages/ai`**: typed input and output (zod), a versioned prompt loaded from `packages/ai/prompts/<name>/v<N>.md`, a retry policy, a timeout, and one row in `ai_calls` per call. No `fetch` to a model endpoint anywhere else.
10. **Keep the folder layout** (section 5). A new top-level folder is added to `docs/ARCHITECTURE.md` in the same commit that creates it. No `utils/`, `misc/`, `helpers/`, `temp/`, `old/`.
11. **Secrets by environment variable.** `.env` is gitignored and lives on the VM (paste 3); `.env.example` lists every name with a one-line meaning. Production values come from Secret Manager through `deploy/vm/up.sh`. Secrets never appear in chat, in a commit, in a log line or in an error message.
12. **Independent review before every stage report, from Stage 0 onward.** `npm run review:stage -- N` sends to the **OpenAI model** named by `OPENAI_REVIEW_MODEL`, in a fresh context with no access to this session, exactly four things: the stage diff (`git diff stage-N-start..HEAD`, which includes the committed draft report), `CLAUDE.md`, the stage prompt, and `docs/stages/stage-N-report.md`. It answers a fixed checklist and nothing else: (a) every invariant upheld, citing file and line, or the violation; (b) every action and route added has a test; (c) every write to an authoritative table is audited; (d) generated documents regenerate without diff; (e) every screen touched renders in both themes from tokens only; (f) any claim in the stage report that the code does not support. Fix every finding and rerun until it reports **no new code defect**. Findings that cannot be resolved by code (by-design behaviour, statements a diff cannot prove, decisions pending from the operator) go in the report with a one-line rationale and do not block the stage.
13. **Security that is deferred is listed, not forgotten** (section 4.3). Do not add it early; do not drop it from the list.
14. **Living documents in the same commit** as the code that changes them (section 5.3).
15. **Simplicity wins ties.** The owner raises a bill a week to the same dozen people from a phone. When two designs tie, choose the one with fewer taps and fewer words; when correctness and simplicity conflict, correctness wins and the complexity is hidden behind a default, never removed.
16. **Hinglish on screen, English on the bill.** Every string the owner sees comes from `packages/copy` with `en` and `hi-Latn` forms; the printed document is English with Indian number formatting. No jargon in Hinglish (the MVP's copy tests enforce this; keep them).
17. **The voice lights up what it talks about.** Every section, field and button that voice or the guide can mention carries a `data-guide` id; when voice says it, the guide highlight (token `--eb-guide`, a glow ring plus a caption bubble) moves to it. Voice never presses a committing button (Bill banao, WhatsApp, Save, Paise aa gaye, Cancel, Bhejo); it lights it up and asks. It may press navigation and "Aage".
18. **Shared VM discipline.** Never touch the tariff or fdre products: not their compose projects, containers, images, volumes (`tariff_pgdata`, `ekbill_pgdata` and friends), ports (3000, 5432, 5433, 8000), firewall rules, Terraform state, or files outside `~/ekbill` and `~/easybills`. Never run `docker system prune` or `docker volume prune`. v2's compose project is **`-p ekbill2`** (the MVP's was `ekbill`). Never run `gcloud compute instances add-metadata`, `set-service-account`, `add-tags`/`remove-tags`, any IAM or firewall command, or edit sshd, ufw, iptables or `/etc/ssh`; `sudo` only for `apt-get install` of a named tool and for the cron line; never `apt-get upgrade` the host. Check free disk at the start of every session and before any seed or build; below 8 GB, stop, run `deploy/vm/free-space.sh`, and if still below 8 GB write the report as "blocked on disk" and STOP.
19. **Rate limits.** Analyse sequentially; use file trees and greps, not whole-directory reads. On a 429, wait 60 seconds and resume.
20. **Rebuild images when dependencies change**, and check container health at the start of each session.
21. **Ask once, in writing.** Questions for the operator go at the end of the stage report, numbered. Do not stop mid-stage to ask unless an invariant would otherwise be violated.

---

## 3. Invariants

These hold in every stage and override anything else in this document. If a stage prompt conflicts with one, the invariant wins and the agent flags the conflict in the report.

**I1 — Tenancy is total.** Every table that holds business data has a `business_id` column, `NOT NULL`, with a foreign key, and row-level security with a policy on `current_setting('app.business_id')`, set per transaction by `withTenant()`. The only tables without `business_id` are `users`, `sessions`, `memberships` (which maps users to businesses and is read once per request, before a scope exists, by `packages/db/auth.ts#resolveScope()`), and `audit_events`' own append path. Every other repository function takes a `TenantScope` (business id, acting user id, role, request id) as its first argument; `tests/integration/tenancy.test.ts` is generated from the repository module list: scope A sees and changes nothing of B.

**I2 — One writer for issued documents.** Only `packages/db/repos/documents.ts#issueDocument()` moves a document to `status = 'issued'`, allocates its number and writes its `issued_snapshot`; it does so in one transaction by calling the pure engine (`packages/engine/issue.ts#prepareIssue()`: assess, compute tax, build the snapshot) and then the numbering allocation and the writes. A Postgres trigger refuses any `UPDATE` to `number`, `issued_at`, `issued_snapshot`, `totals` or `lines` on a row whose status is `issued` or `cancelled`. Corrections are new documents (credit note, cancel-and-redo) that link back. Everything a customer sees (PDF, JPG, receipt, WhatsApp text, GST workings) is rendered from `issued_snapshot`, never from the live business or customer record.

**I3 — Numbers are gapless, per series, per financial year, and never reused.** Allocation happens inside the issuing transaction with `SELECT … FOR UPDATE` on the series row; a unique index on `(business_id, series_id, financial_year, number)` backs it. 50 concurrent `issueDocument()` calls on one series produce exactly 1…50. The MVP's numbering behaviour (prefix, zero padding, optional FY suffix, next number only goes up, FY rollover) is kept as is.

**I4 — Money and tax are deterministic, integer, and come from one engine.** `packages/engine` is pure: no I/O, no database, no model call, no floating point, no `Date.now()`; dates and the rule pack are passed in. Integer paise, integer basis points, rounding specified in `packages/engine/money.ts`. `packages/engine/tax.ts#computeTax()` is the only tax calculation; the bill form preview, the PDF, the receipt and the GST workings all read its output, and `tests/unit/one-engine.test.ts` asserts they agree on a fixture set.

**I5 — GST rules are versioned data, not code.** Rates, selectable rates, document types and their mandatory fields, HSN digit requirements, e-invoice thresholds, composition limits, place-of-supply rules and return calendars live in `packages/engine/rules/gst/*.json`, each entry with `effectiveFrom`, `effectiveTo`, `source` (an official URL), `verifiedOn`, `verifiedBy`. The engine selects by document date; a document's snapshot records the pack version. A rule change is a data change with a fixture test. `npm run rules:check` fails on an entry without a source or a verification date, and on more than 3 entries marked `unverified`.

**I6 — Model output lands in staging only.** Anything a model produces is written to `extractions` or `ai_calls` with provenance (input hash, model, prompt version, per-field confidence) and becomes a bill, a customer or a setting only when a human taps the button that commits it. A trigger forbids inserts into authoritative tables when `current_setting('app.actor_kind', true) = 'model'`.

**I7 — Every authoritative write is audited and attributed.** `documents`, `payments`, `adjustments`, `customers`, `items`, `businesses`, `memberships`, `series` each have a trigger appending to `audit_events` (business_id, actor user id, actor kind, table, row id, action, before, after, request id, at). `audit_events` is append-only. Every request carries a request id that reaches the logs and the audit row.

**I8 — Roles are enforced at the repository, not the screen.** `TenantScope` carries the role; each repository write declares `allowedRoles`; `tests/integration/roles.test.ts` is generated from those declarations (section 8.3). The UI hides what a role cannot do; hiding is not the enforcement.

**I9 — The golden path is measured, and it stays short.** A tap is one pointer press on a control; typing into a field counts as one tap for the field (the keyboard's keys are not counted). From Home, a bill for a known customer with last month's lines is issued and handed to WhatsApp in **≤ 4 taps** (chip, "Haan, wahi bharo", Bill banao, WhatsApp pe bhejo); recording its full payment takes **≤ 3 taps** from Home (dues row, Paise aa gaye, Poore). `tests/e2e/golden-path.spec.ts` counts the taps and times path (a) at ≤ 20 s on Playwright's "Slow 3G / 4× CPU" profile from the Home tap to the share-sheet call. A change that breaks either budget fails CI. Every screen state renders at most one `PrimaryCTA` or `WhatsAppButton`; the test asserts it in the DOM.

---

## 4. Locked decisions

Not reopened unless analysis of the MVP shows something materially better; then `docs/DECISIONS.md` records why.

### 4.1 Stack

| Area | Decision | Why |
| --- | --- | --- |
| Repository | **`Ergplan/ekbill`**, branch `main`; the MVP stays in `Ergplan/easybills` at tag `mvp-final`, checked out read-only at `~/easybills` | A clean history for the audit; the MVP readable on disk |
| Layout | npm workspaces monorepo: `apps/web`, `apps/worker`, `packages/engine`, `packages/ai`, `packages/db`, `packages/copy`, `packages/render`, `packages/ui`, plus `design/` (the pack, imported as a workspace package `@ekbill/design`) | The engine stays pure and testable; UI primitives are the only consumers of tokens |
| Language | TypeScript 5.x, strict | One language per layer; the proven engine is TypeScript |
| Web app | Next.js 16 App Router, React 19, server actions for writes, route handlers for files, standalone output | Works on phones and on the VM; SSR for slow Android browsers |
| UI | `packages/ui`: components from `design/components.md` plus the ones v2 adds (listed in Stage 1); CSS with the pack's tokens; no Tailwind, no component library; both themes always | The pack's depth, textures and glass are the quality bar |
| Themes | Narangi (light, default) and Harmony (dark); `users.theme = narangi \| harmony \| system`; `data-theme` on `<html>` | From the pack |
| Database | PostgreSQL 16 with pgvector, **relational columns**, not jsonb documents | 500 tenants need indexes, constraints, RLS and reporting |
| ORM and migrations | Drizzle ORM with `drizzle-kit` SQL migrations in `packages/db/migrations`; drift check in the watcher and CI; triggers and RLS by hand in the same migrations | Typed schema in code, plain SQL on disk |
| Background work | `apps/worker` with `pg-boss` (Postgres-backed queue): read-bill, render-other-sizes, index-search, reminders-due, backup-check | No Redis; jobs are rows, so they are auditable |
| Auth | Firebase Auth phone OTP (as the MVP), server-minted session cookie; **during the build** `AUTH_MODE=switcher` (section 4.3) | OTP is what these users have |
| Tenancy and roles | One business per tenant; memberships with role `owner`, `staff`, `accountant`; invite by phone | I1, I8 |
| Models | OpenAI through `packages/ai`: a vision-capable model for photographed bills, a text model for Poocho, Realtime for voice; model IDs by environment variable; defaults recorded in the decisions log | The account and key exist; reviewer and auditor are OpenAI, the builder is not |
| Reviewer | `OPENAI_REVIEW_MODEL` is the exact model ID the operator writes in `.env` (paste 3); Stage 0 only checks it resolves against the account's models list and records it | Rule 12; an agent cannot guess an ID from a nickname |
| Printed-document OCR | docling-serve (existing image) for printed PDFs and scans; the vision model for handwriting, with Docling text as a hint | Docling is cheap and local |
| PDF and images | Playwright Chromium in the app image: HTML → PDF (A4/A5/80mm/58mm) and JPEG; the InvoicePaper is theme-independent; **the chosen format is rendered synchronously at issue** (budget 3 s) so the done screen has it; other sizes by the worker on demand | The done screen is on the golden path |
| Search / Poocho | Postgres full text + pgvector hybrid (MVP design), indexing in the worker | Local |
| Voice | OpenAI Realtime over WebRTC, server-minted client secrets, tools that light up, fill and press navigation; never commits (I6, rule 17); wired in Stage 9 | MVP design |
| Copy | `packages/copy`: one dictionary `{en, hi-Latn}` seeded from `design/copy/strings.json` and the MVP's dictionary, with the MVP's jargon and length tests | Rule 16 |
| Logs and metrics | `pino` JSON logs with request id and business id, phones masked; `/api/health`; `/api/metrics` (Prometheus text, Stage 10) | Enough to run 500 businesses on one VM |
| Deployment | Docker Compose project **`ekbill2`** on `tariff-order`: `db` (volume `pgdata` → `ekbill2_pgdata`), `docling`, `app` on 127.0.0.1:8080, `worker`, `caddy`; one image for app and worker; the MVP's `deploy/vm/*.sh` adapted with the project name changed | Separate from the MVP's `ekbill` project and its volume |
| CI | GitHub Actions on push to `main`: the watcher's checks plus Playwright on a Postgres service (`@slow` excluded). Load at 1/10 scale and model evals run on `workflow_dispatch` only | The watcher is for the agent; CI for everyone; no recurring spend |
| Testing | vitest (unit, integration), Playwright (journeys, visual snapshots, tap counts), k6 (load, Stage 10) | What the MVP used, plus load and visual |
| Accountant exports | **One zip**: `workings.xlsx`, every PDF of the period, `gstr1.json` in the GSTN offline-tool format; "CA ko bhejo" opens the share sheet with the zip (WhatsApp, email, Drive) | Operator's answer |
| Composition businesses | Bill of supply with the mandatory legend; the GST tab is hidden (Aap shows "Composition: bill of supply only · CA ko PDFs bhejo"); no workings | Operator's answer |
| Debit notes | Out of scope for v2 (section 4.2) | Rare for these owners; a credit note and a new bill cover the cases |

### 4.2 Product scope for v2

Kept from the MVP: the front-desk home, one-question-at-a-time setup, three-field bill lines, "Pichle jaisa hi", WhatsApp share with PDF or photo, Kiske paise aane hain, Yaad dilao with tone and the customer's language, Likh lo, GST tab only when registered (regular), the guide highlight, voice, Poocho, old-bill import, contract billing helper, bill designs and paper sizes, logo.

New in v2: the design pack's look in two themes; roles and invites; PAN and GSTIN capture with checksum and consistency checks; a drawn signature; photographed handwritten bill → clean bill; an items master with HSN/SAC and rates; multiple numbering series; credit notes as first-class documents; GST workings (GSTR-1 tables, HSN summary, 3B figures) with rule-pack versioning; per-bill GST checks in plain Hinglish; e-invoice readiness (the IRN field); the CA pack; backups with a tested restore; metrics; load-tested for 500 businesses.

Out of scope for v2: filing on the GST portal; IRN generation through an IRP; e-way bills; TDS/TCS under GST; composition returns; debit notes; inventory; purchases and ITC; multi-currency; multi-GSTIN per business; payroll; a desktop-first layout (desktop is the phone layout centred with a side rail); a paid "explain this rule" model call (rule explanations are the pack's own `{en, hi-Latn}` text, shown directly).

### 4.3 Security posture during the build (deferred, explicitly)

The operator's instruction: keep security low during development and testing so the VM is never locked or stopped. Rule 18 lists what the agent may never run on the host.

| Deferred | Until | Meanwhile |
| --- | --- | --- |
| Phone OTP sign-in | Stage 10 | `AUTH_MODE=switcher`: `/dev/switch` lists seeded users and sets the session cookie. Roles and tenancy are still enforced (I1, I8). Stage 10 turns OTP on with a one-line rollback. |
| Rate limits | Stage 10 (60 writes/min per session; sign-in 30/min per IP, the gate user exempt) | Caddy's basic-auth gate stays in front of the app |
| WAF, bot checks, secret rotation, KMS, DLP | Later | |
| SSH restrictions, deny rules, IP allowlists, IAM changes | **Never in this build** | The firewall is not changed except the existing `ekbill-allow-web` rule. Where a later stage needs an IAM grant (Firebase Admin for OTP), the operator makes it; the agent asks in the report. |
| Row-level security, audit log | **On from Stage 2** | Not deferred |
| HTTPS | **On** | Caddy |
| Backups | **On from Stage 0**: nightly cron, last dump checked non-empty by `/api/health`; restore drill in Stage 10 | |

Data on the VM during the build is test data. Every stage report repeats: "Sign-in is switched off; do not put a real business's books here yet."

---

## 5. Folder layout, continuous testing, living documents

### 5.1 Layout

```
ekbill/
  design/                # the design pack, as delivered; a workspace package (@ekbill/design) exporting tokens/themes.css, fonts.css, copy, fixtures
  apps/
    web/                 # Next.js: screens, server actions, route handlers; no business rules
      app/               #   routes
      screens/           #   one folder per screen: component tree, fixture states, manifest.ts (route, purpose, primary action, taps, data-guide ids, roles)
      actions/           #   server actions: validate input, call a repository or service, return ActionResult
      server/            #   server-only helpers: session cookie, resolveScope, request id, logger, auth modes
      lib/               #   browser-side helpers only: guide highlight, voice client, share sheet
    worker/              # pg-boss workers
  packages/
    ui/                  # components from design/components.md + v2's, tokens only, both themes; /kit renders them all
    engine/              # pure TypeScript: money, dates, ids, tax, rules, assess, numbering, prepareIssue, workings, contract
      rules/gst/         #   the GST rule pack (JSON, versioned, sourced) + fixtures; hsn-index.json
    db/                  # Drizzle schema, migrations (SQL), repositories (TenantScope first; issueDocument lives here), auth.ts (resolveScope), triggers, RLS
    ai/                  # the one model client: prompts/<name>/v<N>.md, typed calls, ai_calls, evaluation sets
    copy/                # the dictionary {en, hi-Latn} and its tests
    render/              # InvoicePaper HTML templates (designs, papers), shared by app and worker
  deploy/                # Dockerfile, docker-compose.yml (project ekbill2), Caddyfile, vm/*.sh
  scripts/               # watch.mjs, review-stage.mjs, seed.mjs, flow-map.mjs, trace.mjs, load/*.js (k6)
  tests/
    unit/                # mirrors packages/*
    integration/         # against a real Postgres: repositories, actions, triggers, RLS, roles, tenancy
    e2e/                 # Playwright: journeys, golden-path tap counts, visual snapshots, flow audit
    fixtures/            # bills, kaccha-bill photos (real/ from the operator, with ground truth), rule fixtures, expected PDFs
  docs/
    MASTER-PROMPT.md     # this file
    SCREEN-FLOW.md       # generated from the manifests
    ARCHITECTURE.md      # living
    DECISIONS.md         # living, dated
    KNOWN-GAPS.md        # living
    FIELD-TRACE.md       # generated: every user-visible field → table.column → who may write it
    stages/              # stage-N-report.md, stage-N-review-k.md, stage-1-answers.md
    audit/               # Stage 11
  .watch/                # watcher status.json and log (gitignored)
  CLAUDE.md              # sections 2–5 verbatim, then design/CLAUDE.md's "Always" list; its "Never" list is copied minus the items section 8.0 overrides
```

### 5.2 Continuous testing

`npm run watch` starts beside the app in Stage 0 and stays running in a tmux window. On every save it runs, stopping at the first red: `eslint`, `prettier --check`, `tsc --noEmit` for every workspace, vitest unit tests for the changed package then the full unit suite, `drizzle-kit check`, `npm run rules:check`, `npm run tokens:check`, `npm run trace:check`, `npm run flow:check`, and the integration suite when `packages/db` or `apps/web/actions` changed. It writes `.watch/status.json` (`{ ok, failed: [...], at }`) and `.watch/log`. Playwright, load and paid-model calls are `@slow`: run at the stage boundary and on `workflow_dispatch`.

`tokens:check` is exact: in `apps/web` and `packages/ui`, any `.css`, `.tsx` or `.ts` file matching `#[0-9a-fA-F]{3,8}\b`, `rgba?\(`, `hsla?\(`, `border-radius:\s*\d`, `box-shadow:\s*[^v]`, or `font-family:` fails, unless the file path is listed in `tokens-allow.txt` with a one-line reason (fonts.css, the InvoicePaper template which is theme-independent by design). Pixel sizes for layout are allowed.

### 5.3 Living documents

- `docs/SCREEN-FLOW.md` (generated by `scripts/flow-map.mjs` from the manifests): every screen with its purpose, primary action, other taps and their destinations, fixture states, `data-guide` ids, roles; the golden paths with their exact tap sequences and measured counts. The `/flow` screen renders the same data.
- `docs/ARCHITECTURE.md`: components, data model table (every table: purpose, who writes), the critical paths with real function names, the action and route surface with roles, deployment; "What changed in Stage N" appended each stage.
- `docs/DECISIONS.md`: dated entries: decision, options, why, who asked.
- `docs/KNOWN-GAPS.md`: what is knowingly incomplete, with the stage or condition that closes it.
- `docs/FIELD-TRACE.md`: generated by `scripts/trace.mjs` from zod schemas and Drizzle tables; CI fails on drift or on a field with no owner.

---

## 6. Plan

| Stage | Name | Creates | Stop point |
| --- | --- | --- | --- |
| 0 | Ground | Repo scaffold, `packages/ui` kit from the pack, watcher, review loop, CI, deploy, nightly backup | Kit on the VM in both themes; review ran; or "blocked on disk" |
| 1 | **Screen flow** | Every screen in 8.0 as a clickable prototype on fixtures, both themes; `/flow`; tour highlight; tap counts | Operator approves; repeats until then |
| 2 | Identity, tenancy, roles, audit | Users, businesses, memberships, sessions, audit, `ai_calls`, RLS, scope, switcher | Generated tenancy and roles tests green |
| 3 | The engine | Money, tax, rule pack, document types, numbering, prepareIssue/issueDocument, workings | Engine ≥ MVP test parity; rule pack verified (≤ 3 unverified, accepted by the operator) |
| 4 | Wire: profile and setup | PAN, GSTIN, composition, turnover band, logo, signature, bank/UPI, series, bill look, theme | Setup journey green with a signed, logo'd sample |
| 5 | Wire: customers and items | Customers, items with HSN/SAC, import | MVP import fixtures reproduce |
| 6 | Wire: bills, money, sharing | Documents, payments, credit notes, rendering, WhatsApp, dues, reminders | Golden paths (a) and (b) within budget on real data |
| 7 | Photo → bill | Uploads, extractions, review screen, evaluation on the operator's photos | Eval numbers recorded; nothing commits without a tap |
| 8 | GST compliance | Workings, per-bill checks, IRN field, CA pack, rule-update workflow | Workings match hand-computed fixtures |
| 9 | Wire: the rest | Invites, voice (Realtime), guide tour, Poocho, contract helper, flow audit | Every journey green; flow audit green for every role |
| 10 | 500 businesses | Performance, load (sized), backups drill, metrics, rate limits, OTP on | k6 within budget; restore drill passed; OTP on/off shown |
| 11 | Audit pack and handover | `docs/audit/*`, release tag | A fresh clone passes the CI profile from the README alone |

---

## 7. Stage prompts

### Stage 0 — Ground

```
Stage 0: make the repository, the tooling, the UI kit and the review loop on the shared VM, without touching the other products. Build no product feature and no screen flow (that is Stage 1).

First: .env. Confirm ~/ekbill/.env exists with OPENAI_REVIEW_API_KEY and OPENAI_REVIEW_MODEL filled (paste 3). If not, write the report "blocked on .env" and STOP. With them: list the account's models, confirm OPENAI_REVIEW_MODEL resolves, record the ID in docs/DECISIONS.md. If it does not resolve, report "blocked on OPENAI_REVIEW_MODEL" with the first 20 IDs the account lists, and STOP.

Disk. df -h /. The MVP is already stopped (paste 2; confirm with docker ps: no containers of project ekbill). Run ~/easybills/deploy/vm/free-space.sh (EkBill's old images only). Record before/after. If less than 15 GB is free, do everything below that does not build an image (scaffold, kit, watcher, review, CI, docs, tests under the local Postgres), then write the report as "blocked on disk: N GB free" listing what docker system df shows for the other projects WITHOUT touching them, and STOP. The operator decides what to free.

Repository. You are in ~/ekbill on main with docs/MASTER-PROMPT.md and design/. Create the layout in section 5.1: npm workspaces, TypeScript strict, eslint + prettier, vitest, Playwright (playwright-core with the VM's Chromium at PLAYWRIGHT_CHROMIUM_PATH, as the MVP), Drizzle with an empty schema and a first migration creating schema_migrations and the extensions (pgvector, pgcrypto), a local Postgres for tests (port the MVP's scripts/local-postgres.sh; port 5440, databases ekbill_test and ekbill_dev). Make design/ a workspace package @ekbill/design. Write CLAUDE.md as sections 2–5 verbatim, then design/CLAUDE.md's "Always" list, then its "Never" list minus "Add anything to Home beyond the three cards", "Introduce schedulers, periods, returns" and "Use the accent for anything but …", with one line above: "Where these conflict with the master prompt on flow, tabs, text, product concepts or the guide highlight, the master prompt wins." Write .env.example (every name from paste 3 plus FIREBASE_* for Stage 10, each with a comment).

UI kit (packages/ui). Import tokens from @ekbill/design; copy only the font files into apps/web/public/fonts at build (a script, not by hand). Build every component in design/components.md as a React component, tokens only, both themes, 390px first, and these v2 additions: TabBar with a centre mic action, GuideHighlight (ring + caption, token --eb-guide added to tokens.json and regenerated), SignaturePad, ConfidenceField (coloured by confidence), CheckStrip (the GST intelligence strip), SeriesChip, FilterChips, ShareToggle (PDF/Photo), MakeBar (sticky primary with the amount). A /kit route renders them all with design/fixtures/demo.json and a theme switch. Visual snapshots: /kit in both themes at 390px, stored as the baseline in tests/e2e/__screenshots__ (pixelmatch threshold 0.1, max 0.5 % differing pixels on later runs); also compute and report, without gating, the pixel difference against design/screens/<theme>/00-kit.png so the operator sees how close the kit is. npm run tokens:check as in 5.2, with tokens-allow.txt.

Watcher, review loop, CI. scripts/watch.mjs (5.2); scripts/review-stage.mjs (rule 12, four inputs; the stage prompt is the fenced block for stage N from docs/MASTER-PROMPT.md); npm run review:stage -- N; prove it on this stage. .github/workflows/ci.yml: push to main runs the watcher's checks plus Playwright (@slow excluded) with a Postgres service; a second workflow on workflow_dispatch for load and evals.

Deployment. deploy/: Dockerfile (one image, two commands), docker-compose.yml (project ekbill2 via vm/lib.sh; db with volume pgdata, docling, app on 127.0.0.1:8080, worker, caddy on 80/443), Caddyfile, vm/{lib,up,backup,restore,free-space,set-openai-key}.sh adapted from ~/easybills/deploy (keep the Secret Manager flow and the gate password; change the project to ekbill2; free-space.sh filters project=ekbill2 and never removes anything unattended). Nightly backup in cron (02:30 IST) as the MVP's setup did; /api/health reports last backup age once one exists. Bring v2 up: https://<sslip.io name>/api/health returns ok with an empty schema; /kit reachable behind the gate.

Living documents: ARCHITECTURE.md, DECISIONS.md (the stack table as dated entries; the reviewer model ID), KNOWN-GAPS.md, FIELD-TRACE.md and SCREEN-FLOW.md generated empty, docs/stages/stage-0-report.md. The report asks the operator for: the ≥ 30 real kaccha-bill photos with ground truth (a photo plus a JSON of what it says; or the operator confirms the agent's labels) into tests/fixtures/bills/real/, needed by Stage 7.

Tests required: the watcher goes red on a deliberately failing test and green when removed (in the report, not committed red); review-stage.mjs unit test with a stubbed model; health route integration test; /kit visual baseline in both themes; tokens:check passes on the kit.

Done when: .env confirmed; reviewer model recorded; MVP containers absent and ekbill_pgdata listed as present; watcher green; CI green; /api/health and /kit on the VM OR the report says "blocked on disk" with the numbers; nightly backup scheduled; review ran and findings fixed or listed. STOP.
```

### Stage 1 — Screen flow (approval gate)

```
Stage 1: design the whole app as screens an owner can tap through, on fixtures, with no database, no server logic and no model calls, in both themes, and put it in front of the operator on a review screen. Nothing is wired until the operator approves. Think about simplicity before anything else: bill ready, sent, record updated — in seconds.

Inputs: section 8.0 (flow, buttons, words), design/ (how it looks), packages/ui, design/fixtures/demo.json extended in tests/fixtures/v2.json with: a brand-new owner (nothing yet), the demo business (Sharma Electricals, 12 customers, two series, bills in every state, a credit note, a cancelled bill, three items), a staff member and an accountant of the demo business, one photographed bill in review, one bill with a failing GST check, one composition business. Pure checks copied now from the MVP into stubs packages/engine/ids.ts (GSTIN, PAN) and packages/engine/money.ts (parsing, formatting) with their tests and origin comments; Stage 3 completes the package.

Screens (every one in both themes, 390px first, as apps/web/screens/<name>/ with manifest.ts): welcome, login (phone + OTP layout; dev/switch during the build), setup (one question per screen, section 8.0), home, bill-start, bill, bill-done, bill-view, credit-note, bill-from-photo (and its two error states), remind, bills, customers, customer, customer-new, import, items, item, dues, gst (regular only), you (aap), team, ask, help, dev/switch, kit, flow.

Behaviour in the prototype: navigation is real (Next.js routes); state in the URL and sessionStorage; forms validate with the copied pure checks; "Bill banao" shows the done screen with an InvoicePaper rendered from the fixture; nothing persists; role views via ?as=staff / ?as=accountant hide what section 8.3 forbids.

The guide highlight (rule 17): GuideHighlight from the kit; a "Tour" button on every screen walks its data-guide ids in order with the spoken Hinglish text as the caption. No Realtime session in this stage (that is Stage 9); the tour is what the voice will drive.

The review screen (/flow): the screen map as a tappable graph (each screen a card with its thumbnail in the current theme; arrows labelled with the tap); the golden paths with their exact tap sequences and measured counts; the role matrix; the open questions for the operator, each with a proposed answer; a "walk it" mode that opens the prototype at the start of each golden path. Deployed on the VM behind the gate; the report gives the URL.

Golden paths and budgets (I9), measured in tests/e2e/golden-path.spec.ts on the prototype: (a) Home → chip → "Haan, wahi bharo" → Bill banao → WhatsApp pe bhejo: 4 taps; (b) Home → dues row → Paise aa gaye → Poore: 3 taps; (c) Home → "Photo se" → pick photo (1) → review → Bill banao: ≤ 4 taps plus the picker; (d) a brand-new owner from welcome to the first bill handed to WhatsApp, with the fill-a-field-counts-one rule: ≤ 14 taps, the exact sequence listed in SCREEN-FLOW.md. Redesign until within budget.

Visual tests: every screen screenshotted in both themes at 390px and stored as the baseline (pixelmatch 0.1, max 0.5 % on later runs). For the nine screens with reference PNGs in design/screens, compute the pixel difference and attach the diff images to the report; this is a number for the operator's eye at the approval gate, not a gate. Copy the new screens into design/screens/<theme>/ as references.

Tests required: manifest completeness (every route has a manifest; every manifest tap resolves to a route; every data-guide id exists in the DOM; every role-hidden element is absent for that role); at most one PrimaryCTA/WhatsAppButton per screen state in the DOM; golden-path tap counts; visual baselines; tokens:check; flow:check.

Done when: every screen above exists in both themes; /flow is live on the VM; SCREEN-FLOW.md generated; tap counts within budget; the report lists the open design questions with proposals and the pixel differences; review clean. STOP and wait. The operator writes answers in docs/stages/stage-1-answers.md; "Run Stage 1 again" applies them and repeats. Stage 2 starts only on the operator's line "Run Stage 2 of docs/MASTER-PROMPT.md — APPROVED".
```

### Stage 2 — Identity, tenancy, roles, audit

```
Stage 2 (starts only on the operator's "— APPROVED" line; record it in the report): the people, the businesses, who may do what, the audit trail, and the model-call log. Wire the switcher and the shell; wire no other screen.

Data model (one migration): users (id, phone_e164 unique, name, theme, language, created_at, last_seen_at); businesses (id, legal_name, trade_name, status, created_at, updated_at, created_by; profile fields in Stage 4); memberships (business_id, user_id, role owner|staff|accountant, status invited|active|removed, invited_by, invited_at, accepted_at; unique (business_id, user_id); one active owner per business by partial unique index); sessions (id, user_id, business_id, role, expires_at, created_at, user_agent); audit_events (I7, append-only: revoke UPDATE/DELETE from the app role); ai_calls (id, business_id nullable, user_id nullable, purpose, model, prompt_version, input_hash, tokens_in, tokens_out, cost_micros, latency_ms, outcome, error, at; RLS by business_id with a NULL row allowed for system calls). packages/db/tenancy.sql: applyTenancy(table) adds RLS, the audit trigger and the model-actor refusal (I6), so later stages call it.

Services: packages/db/scope.ts (TenantScope, withTenant setting app.business_id, app.user_id, app.actor_kind, app.request_id); packages/db/auth.ts resolveScope(sessionId) (reads sessions + memberships outside RLS, returns the scope); repos for users, businesses, memberships with allowedRoles on every write, enforced by one allow(scope, roles) wrapper; apps/web/server: session cookie, request id middleware, pino with request id and business id and phone masking; AUTH_MODE=switcher → /dev/switch; otp → 501 until Stage 10; scripts/seed.mjs (three businesses with owner+staff+accountant, deterministic ids; the demo business of the fixtures).

Interface: the approved shell (TabBar, TopBar, theme and language from the user), /dev/switch, /you as approved but read-only.

Tests required: tenancy.test.ts generated from the repository module list (I1); roles.test.ts generated from allowedRoles (I8); audit trigger appends exactly one row per write with before/after; RLS blocks a raw connection with no app.business_id; the model-actor refusal proven with a raw connection that runs SET app.actor_kind = 'model' and tries an insert; session resolution; Playwright: switch to owner of A, see A; switch to staff of B, see B; theme persists per user.

Done when: generated tests green; cross-tenant SQL returns 0 rows (query in the report); ARCHITECTURE.md has the data model table; FIELD-TRACE lists user and business fields; review clean. STOP.
```

### Stage 3 — The engine

```
Stage 3: packages/engine, pure and complete, plus the document tables and issueDocument() in packages/db. No screens are wired.

Salvage (rule 6, section 8.1) from ~/easybills with origin comments and tests: money, tax-engine (+ ruleset becomes JSON), gstin and state-codes, scenarios → assess, numbering, bill-guard and bill-form logic, contract, gst-returns workings/export/qrmp, dates. Re-shape to v2 types; keep every test passing (adapt names, not behaviour); list dropped tests with reasons.

Rule pack (I5): packages/engine/rules/gst/ with a zod schema and these files from section 8.2: rates.json, document-types.json, hsn.json, e-invoice.json, composition.json, place-of-supply.json, returns-calendar.json, credit-note-limits.json; hsn-index.json (chapter-level HSN and SAC headings with descriptions, from the CBIC GST rate schedules and the SAC list on cbic-gst.gov.in; the source URL and the fetch date in the file). Verify each entry by fetching its official source (WebFetch; if the VM cannot reach it, say which URL failed). At most 3 entries may stay "unverified"; they are listed in the report for the operator to accept or supply. npm run rules:check enforces I5.

Modules (pure): money.ts; dates.ts; ids.ts; rules.ts (load, select by date, explain(ruleId) → {en, hi-Latn}); tax.ts computeTax (per-line rates, inclusive/exclusive, inter/intra, cess by rate, rounding, rule ids used); assess.ts assessDocument (kind, title, blockers in Hinglish with what-you-can-do, notices, rule ids: GSTIN when charging tax, place of supply known, HSN digits by turnover band, B2C ≥ ₹50,000 recipient details, composition legend, e-invoice applicability, 30-day IRN band, credit-note date limit, reverse charge, nil/exempt on the wrong document); numbering.ts (series config, format, validate, next, FY rollover); issue.ts prepareIssue(draft, business, customer, rules, today) → {blockers} | {snapshot, totals, kind}; workings.ts (GSTR-1 B2B, B2C large/small, CDNR, HSN summary; 3B outward; by period; from snapshots only).

packages/db: series (business_id, name, prefix, padding, include_fy, next_number, fy, active, kind bill|credit_note); documents (id, business_id, series_id, kind tax_invoice|bill_of_supply|credit_note, status draft|issued|cancelled, number, financial_year, issue_date, due_date, customer_id, customer_name, customer_gstin, customer_state, place_of_supply_state, flags jsonb (without_gst, reverse_charge), lines jsonb (drafts), totals jsonb, issued_snapshot jsonb, issued_at, linked_document_id, irn, cancelled_at, cancelled_reason, revision, created_by, updated_at); repos/documents.ts: issueDocument (I2, I3: FOR UPDATE on the draft and the series, prepareIssue, allocate, write, audit), cancelDocument, createCreditNote (its own series kind); the immutability trigger; applyTenancy on both tables.

Tests required: all salvaged tests green; a fixture per rule entry (dated inside and outside its window); tax fixtures including mixed rates, inclusive pricing, inter-state, rounding; one-engine.test.ts on 20 fixtures (I4); numbering concurrency 1…50 (I3); issuance integration (draft→issued, blockers refuse, cancel, credit note links, immutability refuses UPDATE, audit rows); workings fixtures hand-computed with the arithmetic in a comment; a purity test: packages/engine imports nothing from node:, pg, drizzle or packages/ai (lint rule).

Done when: rules:check passes (≤ 3 unverified, listed); engine unit tests ≥ the MVP's count for the same modules (numbers in the report); I2–I5 cited file:line; review clean. STOP.
```

### Stage 4 — Wire: profile and setup

```
Stage 4: wire the approved setup and Aap screens. Owner only for writes.

Data model: extend businesses (address, city, pincode, state_code, phone, email, pan, gstin, registration_type regular|composition|not-registered|not-sure, turnover_band (the chips in 8.0), e_invoicing_applies nullable, bank fields, upi, default_payment_terms_days, bill design/paper/share-as/accent, logo_file_id, signature_file_id, default_series_id); business_files (kind logo|signature, bytes ≤ 300 KB, mime, sha256). Files stay in Postgres.

Checks (engine): PAN format; GSTIN checksum; PAN-inside-GSTIN equals the PAN field when both given; GSTIN state equals the chosen state; registration_type agrees with the setup answer (Haan → regular, Composition → composition, Nahi → not-registered, Pata nahi → not-sure); composition requires the legend; e_invoicing_applies must be answered when turnover_band ≥ "5 crore se zyada".

Signature pad: SignaturePad from the kit; trimmed transparent PNG ≤ 60 KB; stored as business_files kind=signature; printed as the authorised signatory with "For <legal name>". Logo: the MVP's picker. Theme and language on the user. Series: add, rename, retire, default.

Tests required: PAN/GSTIN/consistency unit tests (including the MVP's); file limits; signature trimming on fixture strokes; roles regenerate (owner-only writes); Playwright: full setup with signature at 390px in both themes, including the composition and "Pata nahi" branches; Aap shows everything and Save works once; the sample preview shows logo and signature.

Done when: setup end to end on the VM; FIELD-TRACE lists every profile field with owner-only write; review clean. STOP.
```

### Stage 5 — Wire: customers and items

```
Stage 5: who the bills go to and what is usually on them.

Data model: customers (name, contact_person, phone, email, address, city, pincode, state_code, gstin, pan, language, language_source, notes, archived, last_billed_at; unique (business_id, phone) when present), items (name, description, hsn_sac, unit, default_rate_paise, default_tax_bp, price_includes_tax, archived; unique (business_id, lower(name))), imports (staging rows; I6: nothing lands without the owner ticking).

Services: customers repo (staff may create and edit, not delete), items repo, GSTIN → state/PAN derivation, language guess (salvage), import pipeline in the worker (CSV/XLSX, PDF text via pdfjs, Docling for scans, the salvaged matcher), "add karo" commits ticked rows; HSN/SAC lookup from hsn-index.json.

Interface: the approved customers, customer, customer-new, import, items, item screens.

Tests required: repos + roles + tenancy regenerate; the MVP's import fixtures reproduce its results (1 customer from the PDF, 3 from the CSV, duplicates recognised); items uniqueness; Playwright: add a customer, import, tick two, see them.

Done when: import journey green; FIELD-TRACE updated; review clean. STOP.
```

### Stage 6 — Wire: bills, money, sharing

```
Stage 6: the reason the app exists. Wire the approved bill-start, bill, bill-done, bill-view, credit-note, remind, bills and dues screens.

Services: startDocument (draft); the form (three fields, per-line GST when chosen, GST lagega? Haan/Nahi → bill of supply for regular businesses; composition businesses get no GST strip and a bill of supply always; items suggestions; Pichle jaisa hi; duplicate and rate-oddity guards; inline new-customer details; CheckStrip from assess()); issue via issueDocument with the chosen format rendered synchronously (packages/render; budget 3 s) into document_files (document_id, kind pdf|jpg, paper, design, bytes, sha256); other sizes by the worker on demand; the route serves bytes with the roles check; credit note and cancel-and-redo (owner only); payments (Likh lo full/part, Kam karo as an adjustment, reversal; balance = one function; the MVP's lifecycle test is tests/integration/payments.test.ts); dues; reminders with tone and the customer's language, reminders_sent, a worker job listing "due today" (no auto-sending); search index job.

Tests required: integration tests for every action with roles (staff makes bills and records money, cannot cancel or credit-note; accountant read-only); render tests (key strings; PDF page size per paper; issue-time render under 3 s on the VM); payment lifecycle (issue → part → full → reversal → balance 0); immutability on re-render; Playwright: the MVP's smoke and bills journeys ported to the approved screens in both themes; golden paths (a) and (b) against real data within budget (I9).

Done when: both journeys green; four papers × two formats download with logo and signature; one-engine test includes the form preview; golden paths within budget on the VM; review clean. STOP.
```

### Stage 7 — Photo → bill

```
Stage 7: an owner photographs a handwritten kaccha bill (or an old printed one) and gets a correct, clean draft to check and make. Model output is staging only (I6). The operator's photos and ground truth are in tests/fixtures/bills/real/ (asked for in the Stage 0 report); if fewer than 30 are there, use synthetic ones for the rest and state the counts.

Data model: uploads; extractions (model, prompt_version, docling_used, result jsonb {customer, date, lines[{what, qty, unit, rate, amount, hsn?}], totals, notes}, confidence per field, warnings, cost, latency, status pending|reviewed|committed|discarded, committed_document_id); extraction_corrections (field path, model value, human value).

Pipeline (worker read-bill): normalise (EXIF rotate, ≤ 2000 px, JPEG q85) → Docling for printed input or as a hint → packages/ai vision call with the image, the Docling text, the business's item names and customer names, prompt prompts/read-bill/v1.md asking for the schema with per-field confidence and "unreadable" allowed → engine validation (numbers parse, qty×rate≈amount flagged, totals re-computed by computeTax and never trusted from the image, dates plausible, customer matched with a score) → extraction row. Never a document. Error states: unreadable photo → "Photo saaf nahi aayi, dobara lo" with retake; nothing found → "Isme bill nahi mila" with "Naya bill likho".

Review screen (approved in Stage 1): ConfidenceField colouring (≥ 0.85 green, amber, red); unreadable fields empty and lit; totals are the engine's with a note when they differ; Bill banao → Stage 6's draft path; corrections recorded.

Evaluation (packages/ai/eval): npm run eval:read-bill over the real set reports field accuracy, line recall, total-match rate and abstention rate separately; results in the report; bump the prompt version when changed. Ground truth is the operator's, never the model's.

Tests required: normalisation; schema validation (malformed → error row, never a crash); the engine never trusts image totals; roles (staff may upload and review); Playwright: upload a fixture, see confidences, correct a field, make the bill, see the correction row; golden path (c) within budget.

Done when: eval numbers recorded on the real set (counts stated); I6 cited to the trigger and the commit path; cost per read from ai_calls; review clean. STOP.
```

### Stage 8 — GST compliance

```
Stage 8: the GST tab, the per-bill checks, the CA pack, and the workflow that keeps the rules current. Nothing files anything; everything explains itself in the pack's own words (no paid model call here).

Workings (engine + a service): /gst for a regular business, with exactly what 8.0 lists on screen (period, two tiles, rate split, B2B list, B2C note, CA ko bhejo); CDNR, HSN summary and 3B figures live in the pack and in the drill-down; drill-down from any figure to the documents behind it (port the MVP's drill-down tests). CA pack: one zip (workings.xlsx, every PDF of the period, gstr1.json in the GSTN offline-tool JSON format; cite the GSTN offline tool's sample file as the schema source and validate against it); "CA ko bhejo" opens the share sheet with the zip.

Per-bill checks: assess() on the bill form (CheckStrip) and at issue, in Hinglish with a "kyun?" that shows rules.explain(ruleId): place of supply; customer GSTIN state vs place of supply; HSN digits for the turnover band; B2C ≥ ₹50,000 recipient details; composition legend; e-invoice applicability (if applicable: "IRN zaroori hai" and the IRN field the owner fills after generating it elsewhere; the document prints IRN and QR when present); 30-day IRN band warning; credit-note date limit; a bill dated across a rate change uses its date's rates and says so; reverse charge legend; nil/exempt lines on the wrong document.

Rule-update workflow: npm run rules:update lists every entry with source and verifiedOn; re-verify, update, bump the pack version, add a fixture; docs/GST-RULES.md generated from the pack, with a prose section (IMS, e-way bill, registration thresholds) for the CA.

Tests required: workings fixtures hand-computed for a quarter with mixed rates, inter-state, a credit note and a cancelled bill; drill-down sums equal documents (generated); every check has pass and fail tests; the xlsx parses back to the workings; gstr1.json validates against the GSTN sample's structure; Playwright: a regular business opens a quarter, drills into B2B, shares the pack, sees a check on a bill and taps "kyun?".

Done when: every rule entry verified within this stage or within the ≤ 3 cap; workings green; GST-RULES.md regenerates; review clean. STOP.
```

### Stage 9 — Wire: the rest of the front desk

```
Stage 9: everything else the approved flow has: team and invites, voice, the guide tour, Poocho, the contract helper, the flow audit. Change nothing permanent.

Invites: owner invites by phone with a role; the invitee signs in with that phone (switcher during the build) and lands in the business; remove; change role.
Voice (salvage and adapt; the first real Realtime session in v2): the "Bolke" opt-in on Aap and the mic in the tab bar; screen descriptions from the manifests' data-guide maps; show/fill/press-navigation; committing buttons lit, never pressed (rule 17); the setup and photo-review walk-throughs; every session minted server-side and logged in ai_calls.
Guide tour: per screen, from the manifests. Poocho: hybrid search + grounded answer (salvage). Contract helper (salvage).
Copy: every string through packages/copy; the dictionary tests.
Flow audit (port scripts/e2e-flow.mjs): every screen as a new owner, as staff, as accountant and as the demo business; in by the button, out by the back arrow; no sideways scroll; a way out; tap sizes ≥ 44px; no junk text; no English leftovers; both themes.

Tests required: all MVP journeys ported and green in both themes; roles in the UI by Playwright; invite lifecycle integration; voice unit tests; golden path (d) within budget.

Done when: every journey green on the VM; flow audit green for every role and theme; route count = manifest count = SCREEN-FLOW.md; review clean. STOP.
```

### Stage 10 — 500 businesses

```
Stage 10: make it hold 500 businesses on this VM, prove it, and turn sign-in on without locking anyone out.

Performance: indexes for every list and dues query (EXPLAIN ANALYZE for the five slowest); p95 budgets: home 400 ms, bill form 300 ms, issue incl. render 3 s, photo read 20 s; pool sizing; worker concurrency; tenant data never cached across requests.
Load (k6): before seeding, estimate disk (rows × average size) and abort if it would leave less than 8 GB free (rule 18). Seed 500 businesses × 40 customers × 30 bills (600,000 documents, no PDFs rendered) by an idempotent worker job; scenarios: 50 owners making bills, 200 reading dues, 10 rendering PDFs, 5 photo reads; run at 1/10 scale whenever, the full run only when the operator says "go" in a message; p50/p95 per route against the budgets; fix and rerun or list the gap with a cause. Delete the seed afterwards (a job that removes only businesses tagged load-test).
Operations: /api/metrics; phones masked in logs; restore drill (last night's dump into a scratch database, the integration suite against it, time recorded); image size ≤ 1.5 GB; a weekly cron that only logs docker system df and the free space (no removal unattended); rate limits (section 4.3) with Hinglish messages; health includes queue age and last backup age.
Sign-in: AUTH_MODE=otp with Firebase phone OTP (salvage), Admin credentials through the VM's service account — the operator grants the IAM role (ask in the Stage 9 report; the agent never changes IAM); the switcher disabled in production by the one env var; the report gives the exact rollback (AUTH_MODE=switcher, up.sh); the Caddy gate stays until the operator says otherwise. The OTP Playwright journey runs in CI against the Firebase Auth emulator (firebase-tools + Java in the CI image), not on the VM.

Tests required: k6 at 1/10 on workflow_dispatch; restore drill scripted; rate-limit tests; OTP journey on the emulator in CI; metrics endpoint test.

Done when: k6 within budget at 500 tenants (or the gap listed with a cause); restore drill passed with time; OTP on and off demonstrated; the load seed removed; review clean. STOP.
```

### Stage 11 — Audit pack and handover

```
Stage 11: prepare everything an independent OpenAI-model audit needs to assess the code in every aspect, and hand over.

docs/audit/: README (run the CI profile from a clean clone: ephemeral Postgres, no VM services, @slow excluded, no secrets), THREAT-MODEL.md (assets, actors, boundaries, the deferred-security list with current state), DATA-MODEL.md (generated), FIELD-TRACE.md, SCREEN-FLOW.md, RULES.md (the GST pack with sources), TEST-INVENTORY.md (generated), COVERAGE.md, REVIEWS.md (every stage review and resolution), KNOWN-GAPS.md, DEPENDENCIES.md (npm audit, licences incl. the Urbanist OFL), PERFORMANCE.md, AUDIT-PROMPT.md addressed to the auditor (scope: security, correctness, GST compliance against the rule pack, tenancy, data integrity, operability, code quality, UI against the design pack; the invariants and where each is enforced; the expected output: findings with severity, file:line, reproduction, fix).

Repository: tag v2.0.0-rc1; README.md (what EkBill is, run, deploy, the design pack); confirm mvp-final resolves in Ergplan/easybills.

Done when: a fresh clone in a temporary directory on the VM passes the CI profile from the README alone; the pack is complete; the report says what to tell the auditor. STOP.
```

---

## 8. Reference data

### 8.0 The screen flow this prompt decides (input to Stage 1)

The design pack is the quality bar for how it looks: the Narangi warmth and Harmony glass, the dot-grid ground, the folder with peeking bills, the 36px hero radius, the lavender money panel, Urbanist with tabular figures, 44px targets. Stage 1 builds to that bar. What follows is what the app *is*; Stage 1 turns it into screens, and the operator approves or changes it on `/flow`.

**Principle:** one screen asks one question; the primary action is where the thumb rests; the words are the owner's words. Nothing on Home that is not one of the three questions.

**Home (Ghar)** — Namaste by name; three cards: **Kiska bill?** (customer chips by recency, a search when more than eight, "Naya customer", "Photo se bill"), **Bheje hue bills** (count this month, three latest rows, "Saare dekho"), **Kiske paise aane hain** (total, oldest age, rows with "Yaad dilao", "Sab dekho"). The mic is the tab bar's centre action. Staff see the same; accountants see the second and third cards only.

**Tab bar** — Ghar · Bills · [GST, regular businesses only] · Aap, with the mic as the floating centre action. Customers and items are reached from Home's chips, from Bills and from Aap, not a tab.

**Kiska bill → Bill** — tap a chip → the form with "Pichle jaisa hi?" at the top when a previous bill exists ("Haan, wahi bharo" fills the lines; "Naya likho" clears); KAAM cards with Kya kiya / Kitna / Rate and Rakam computed; "Aur kaam jodo"; for a regular business a quiet strip "GST: 18% sab pe · badlo" that opens Haan/Nahi, one rate or per-line; for a composition business no strip and the words "Bill of Supply banega (composition)"; the CheckStrip appears only when a check fails ("Customer ka state chuno" with one tap to fix); the MakeBar "Bill banao · ₹6,200". New customer: the name field first, phone and GSTIN folded.

**Bill done** — tick, "Bill ban gaya!", the InvoicePaper preview (white, English, already rendered), **WhatsApp pe bhejo** (green, the only green), ShareToggle PDF/Photo, "Doosra size" (sheet: A4, A5, 80mm, 58mm × PDF/Photo), "Ghar", "Isi customer ka aur ek".

**Bill view (sent)** — amount due large, status pill, **Paise aa gaye** (then Poore / Kuch hissa → amount, date, kaise), Yaad dilao, "WhatsApp dobara", "Download" (PDF), "Galti ho gayi?" folded: "Cancel karke naya banao" (reason, one line; opens a fresh draft with the same lines) and "Rakam kam karo" (credit note: amount, one-line reason → a credit note document linked to this bill, shown under it with its own number).

**Yaad dilao** — ToneSegmented (Pyaar se / Seedha / Doosri baar), the message in the customer's language with the bill attached (PDF or Photo per the business's choice), "Bhasha badlo", **WhatsApp kholo**.

**Photo se bill** — camera or gallery → "Padh rahe hain…" (progress) → review: photo on top, the draft below with ConfidenceField colouring; tap a field to fix; "Bill banao". Errors: "Photo saaf nahi aayi, dobara lo" (retake) and "Isme bill nahi mila" ("Naya bill likho").

**Bills** — list newest first, FilterChips (Sab / Baaki / Aa gaye / Cancel), SeriesChip when more than one, search.

**Dues (Kiske paise aane hain, full)** — total, then every unpaid bill oldest first with age, amount, "Yaad dilao" and "Paise aa gaye" per row.

**Customers / Customer / Naya customer** — directory with search and "Naya customer"; the customer folder: last three bills peeking, period total and due, timeline, "Inka bill banao"; details folded (phone, GSTIN, PAN, state, language, notes). Naya customer: name, then phone, GSTIN (state and PAN derived), language — "Customer jodo".

**Import (Purane bills upload karo)** — from Customers: pick files (PDF, photos, CSV/XLSX) → "Padh rahe hain…" → rows with a tick each, "Pehle se hai" marked → "N customers add karo".

**Items / Item** — from Aap and from the form's suggestions; list with search; item: name, HSN/SAC with lookup, unit, rate, GST rate — "Save".

**GST (regular businesses only)** — period (month, or quarter under QRMP), two stat tiles (Bills, GST), rate split, B2B list, B2C note, drill-down on any figure, **CA ko bhejo** (share sheet with the zip). Composition and unregistered businesses have no tab.

**Aap** — dukaan (name, address, PAN, GST, state, turnover band), paise kaise dein (UPI, bank folded), bill number series, bill kaisa dikhe (logo, signature, design, colour, paper, PDF/photo, sample), theme (Narangi/Harmony/System), language (Hinglish/English), "Bolke" (voice on arrival: on/off), team (owner only), app ki jaankari, one sticky Save.

**Team** — members with role pills; "Invite karo": phone, role (Staff / Accountant), "Bhejo" (the invite is a WhatsApp message with the link); per member: change role, "Hatao".

**Ask (Poocho)** — one question box, examples as chips, the answer with the records it came from, "Aur poochho".

**Help (Mera bill thoda complex hai)** — the contract helper entry: three choices (percentage of a contract, instalments, running bill) → the MVP's helper flow restyled.

**Setup (first time)** — "Namaste ji! Hum pehli baar mil rahe hain, to apne baare mein thoda bataiye please." then one question per screen: dukaan ka naam → PAN (skip; asked again when a GSTIN is given) → "GST mein registered ho?" (Haan / Composition mein hoon / Nahi / Pata nahi) → GSTIN (Haan and Composition only) → "Saal ka dhandha lagbhag kitna?" (chips: 40 lakh tak · 40 lakh–1.5 crore · 1.5–5 crore · 5 crore se zyada; Haan only) → "Kya aapke bills sarkari e-invoice portal se bante hain (IRN)?" (Haan / Nahi / Pata nahi; only when 5 crore se zyada) → UPI (skip) → sheher/rajya (prefilled from GSTIN) → signature (skip; asked again before the first bill) → "Sab sahi hai?" with Badlo per row → "Chalo, shuru karte hain". The guide can lead it.

**Welcome / Login** — the pack's hero, phone, OTP; during the build `/dev/switch` (a list of seeded people with their business and role; tap to become them).

### 8.1 What to salvage from the MVP (tag `mvp-final`), and what not to

| MVP path | Into | Note |
| --- | --- | --- |
| `src/lib/money/index.ts` | `packages/engine/money.ts` | Paise, formatting, words |
| `src/lib/gst/tax-engine.ts`, `ruleset.ts` | `packages/engine/tax.ts`, rule pack | Ruleset becomes JSON |
| `src/lib/gst/gstin.ts`, `state-codes.ts` | `packages/engine/ids.ts`, `states.ts` | |
| `src/lib/gst/scenarios.ts` | `packages/engine/assess.ts` | |
| `src/server/repos/invoices.ts` (numbering, issuance shape) | `packages/engine/numbering.ts`, `issue.ts`; `packages/db/repos/documents.ts` | Keep behaviour |
| `src/lib/domain/bill-guard.ts`, `bill-form.ts`, `contract.ts`, `language-guess.ts`, `whatsapp.ts` | `packages/engine` | |
| `src/lib/gst-returns/workings.ts`, `export.ts`, `qrmp.ts` | `packages/engine/workings.ts` | |
| `src/lib/dates.ts` | `packages/engine/dates.ts` | |
| `src/lib/copy/*` | `packages/copy` | Merged with `design/copy/strings.json`; tests kept |
| `src/server/pdf/*` | `packages/render`, worker | Designs, papers, JPEG, UPI QR |
| `src/lib/import/*`, `src/server/import/*`, `src/lib/search/*`, `src/server/search/*` | worker + engine | |
| `src/lib/voice/*`, `src/components/voice/*`, `src/app/api/voice/*`, `src/lib/guide/*`, `src/components/guide/*` | `apps/web/lib`, `apps/web/server` | Restyled with tokens; Stage 9 |
| `scripts/e2e-*.mjs`, `tests/integration/payments.test.ts` | `tests/e2e`, `tests/integration` | Ported journeys, the flow audit, the payment lifecycle |
| `scripts/local-postgres.sh`, `deploy/*` | `scripts/`, `deploy/` | Adapted; project `ekbill2`; `infra/gcp` not re-applied |
| `docs/gst-owner-guide.md`, `owner-guide.md` | `docs/` | Updated |

Do not copy: the jsonb document store, Firestore remnants, the old settings page, the MVP's CSS (the pack replaces it), the single-test-user AUTH_BYPASS (replaced by the switcher with roles), `tests/global-setup.ts` as is.

### 8.2 GST rule pack — starting content (verify every line in Stage 3)

Status as of 13 October 2026 from secondary sources; each entry must be checked against its official source before `verifiedOn` is set. IMS, e-way bills and registration thresholds are prose in `GST-RULES.md`, not pack entries.

| File | Entry | Value to verify | Source to cite |
| --- | --- | --- | --- |
| rates.json | Slabs from 2025-09-22 (56th Council) | 0%, 5%, 18%, 40%, plus 0.25% and 3% special | CBIC rate notifications Sept 2025; PIB |
| rates.json | Slabs before 2025-09-22 | 0, 5, 12, 18, 28 (+0.25, 3) for earlier-dated documents | Earlier schedules |
| rates.json | 57th Council, 2026-10-08 | Recommendations only, no rate change; compliance changes pending notification — add nothing until notified | PIB "Recommendations of the 57th Meeting" |
| document-types.json | Tax invoice mandatory fields | Rule 46: supplier name/address/GSTIN; unique serial ≤16 chars per FY; date; recipient details, GSTIN if registered; HSN/SAC; description; qty+unit; total; taxable value; tax split CGST/SGST/IGST/cess; place of supply with state for inter-state; delivery address if different; reverse-charge indicator; signature (not on e-invoice) | CGST Rules, Rule 46 |
| document-types.json | B2C recipient details | Required when invoice value ≥ ₹50,000 to an unregistered recipient | Rule 46(e)/(f) |
| document-types.json | Bill of supply | Composition and exempt/nil; no tax lines; the composition legend | Rule 49; Sec 31(3)(c) |
| document-types.json | Credit note | Sec 34; declare by 30 Nov after FY end or the annual return, whichever earlier; Rule 53 fields | Sec 34, Rule 53 |
| hsn.json | Digits on invoices | Turnover ≤ ₹5 crore: 4 digits B2B mandatory, B2C optional; > ₹5 crore: 6 digits; SAC 6 digits starting 99 | Notification 78/2020-CT |
| e-invoice.json | Applicability | Turnover > ₹5 crore in any FY from 2017-18, from 2023-08-01; sector exemptions | Notification 10/2023-CT |
| e-invoice.json | 30-day reporting | ≥ ₹10 crore from 2025-04-01 (one secondary source shows 2026 — resolve from the GSTN advisory) | GSTN advisory |
| composition.json | Limits and legend | Goods ₹1.5 crore (₹75 lakh special states); services ₹50 lakh; cannot collect tax | Sec 10; Rule 7 |
| place-of-supply.json | Supported cases | B2B: recipient's state; B2C goods: delivery state; B2C services: supplier's state unless tied to property/event → ask | IGST Act Sec 10–12 |
| returns-calendar.json | Due days and locks | GSTR-1 11th / QRMP 13th; 3B 20th (22nd/24th QRMP); 3B outward auto-population non-editable from July 2025 (GSTR-1A for corrections); ITC Table 4 lock status unverified; 3-year filing limit | GSTN advisory 2025-06-07 |
| hsn-index.json | Chapter-level HSN and SAC headings | From the CBIC rate schedules and SAC list; fetch date recorded | cbic-gst.gov.in |

### 8.3 Roles

| Action | owner | staff | accountant |
| --- | --- | --- | --- |
| Business profile, series, look, signature, logo, theme | ✓ | | |
| Invite / remove members | ✓ | | |
| Add / edit customers and items | ✓ | ✓ | |
| Make bills, read photos, issue | ✓ | ✓ | |
| Record money, reminders | ✓ | ✓ | |
| Cancel, credit note | ✓ | | |
| See bills, dues, GST workings | ✓ | ✓ | ✓ |
| Export the CA pack | ✓ | | ✓ |
| Delete anything | nobody (archive only) | | |

### 8.4 Budgets

Golden paths per I9; page ≤ 200 KB JavaScript on the bill form; first paint ≤ 2 s on the throttled profile; both themes within the same budgets; issue-time render ≤ 3 s; app image ≤ 1.5 GB; model cost per photographed bill ≤ ₹3 (from `ai_calls`); backup ≤ 10 min; restore ≤ 15 min.

---

## 9. Definition of done

| Stage | Checks before STOP |
| --- | --- |
| 0 | `.env` confirmed; reviewer model ID recorded; MVP containers absent, `ekbill_pgdata` present; watcher and CI green; `/api/health` and `/kit` on the VM, or "blocked on disk" with numbers; kit visual baseline in both themes; tokens:check passes; nightly backup scheduled; review script proved |
| 1 | Every screen in 8.0 exists in both themes at 390px; manifests complete and consistent; ≤ 1 primary per screen state (DOM); `/flow` live on the VM; SCREEN-FLOW.md regenerates; golden-path tap counts within I9 with the sequences listed; pixel differences against the nine reference PNGs reported; open questions with proposals; **the operator's "— APPROVED" line before Stage 2** |
| 2 | "— APPROVED" recorded; generated tenancy and roles tests green; cross-tenant SQL 0 rows; audit trigger one row per write; RLS and model-actor refusals proven on raw connections; `ai_calls` exists with RLS; switcher journey green; FIELD-TRACE has user/business fields |
| 3 | rules:check passes with ≤ 3 unverified listed; engine tests ≥ MVP count (numbers); purity lint passes; concurrency 1…50; immutability trigger refuses; one-engine on 20 fixtures; I2–I5 cited file:line |
| 4 | Setup journey with signature, composition and "Pata nahi" branches, both themes; PAN/GSTIN consistency tests; file limits; owner-only writes; sample shows logo + signature |
| 5 | MVP import fixtures reproduce; items uniqueness; customers and import journeys green |
| 6 | Smoke and bills journeys green, both themes; four papers × two formats; payment lifecycle; one-engine includes the form; issue-time render ≤ 3 s; golden paths (a) and (b) within budget on real data |
| 7 | Eval numbers on the real set with counts stated (accuracy, recall, total-match, abstention separately); malformed output → error row; commit needs a tap; cost per read; golden path (c) |
| 8 | Workings fixtures hand-checked; drill-down sums; every check pass/fail tested; xlsx parses back; gstr1.json validates against the GSTN sample; GST-RULES.md regenerates; pack within the cap |
| 9 | All journeys green, both themes; flow audit green for owner, staff, accountant, demo; invite lifecycle; voice sessions logged; routes = manifests = SCREEN-FLOW; golden path (d) |
| 10 | Disk estimate before seeding; k6 within budgets at 500 tenants or the gap listed; seed removed; restore drill time; rate limits; OTP on/off with rollback; metrics test |
| 11 | Fresh clone passes the CI profile from the README alone; audit pack complete; tag `v2.0.0-rc1` |

Two honest numbers beat one composite: every rate is reported with what was attempted and what was correctly abstained from.

---

## 10. Decisions recorded from the operator (13 Oct 2026)

1. Repository: new, `Ergplan/ekbill`; MVP frozen at `mvp-final` in `Ergplan/easybills`.
2. GitHub access from the VM: `gh auth login` as the operator (paste 1).
3. The MVP's containers are stopped before Stage 0 (paste 2); its data volume `ekbill_pgdata` is kept.
4. Real kaccha bills with ground truth will be provided for Stage 7's evaluation (asked for in the Stage 0 report).
5. Reviewer: the OpenAI model the operator named; the operator writes its exact ID in `.env` (paste 3); Stage 0 checks it resolves.
6. CA pack: one zip with the Excel workings, every PDF and the GSTR-1 JSON, sent from the share sheet.
7. Security stays low throughout the build (section 4.3, rule 18); nothing that can lock the operator out.
8. Composition businesses: bill of supply only; no GST tab.
9. The voice lights up the section it talks about (rule 17).
10. The screen flow is designed and approved on `/flow` in Stage 1 before any wiring; the design pack sets visual quality, this prompt sets flow, buttons and text (rule 7, section 8.0).

## 11. What changed in draft 3 (from the independent review of draft 2)

- The engine is pure; the transaction (`issueDocument`) lives in `packages/db` (I2, I4, 5.1, Stage 3).
- `users`, `sessions`, `memberships` are named as the tables outside tenancy, with `resolveScope()` (I1).
- v2's compose project is `ekbill2`, so no v2 command can touch the MVP's `ekbill_pgdata` (rule 18, 4.1, Stage 0).
- `ai_calls` is created in Stage 2; the documents table is spelled out in Stage 3; `hsn-index.json` has a source; the payment lifecycle test is named.
- Screens that stages wire but 8.0 had not designed (import, credit note, dues, team, ask, help, customer-new, item, dev/switch, download) are now in 8.0 and Stage 1; debit notes are out of scope.
- Setup asks about composition and the turnover band; the e-invoice question has words; composition hides the GST tab; the CA pack is one zip sent from the share sheet.
- The reviewer model ID is written by the operator in `.env` before Stage 0 (paste 3); the review loop sends four inputs including the committed draft report; Stage 0 has "blocked on .env" and "blocked on disk" stop states.
- Gameable checks fixed: numeric visual thresholds as regression gates with the pack comparison reported, not gated; ≤ 1 primary asserted in the DOM; taps defined; ≤ 3 unverified rule entries; ground truth from the operator; the GSTN sample as the JSON schema; an exact `tokens:check` pattern with an allowlist; approval is the operator's own typed line.
- Lock-out and VM risks: rule 18 forbids metadata, IAM, tags, sshd/ufw and host upgrades; the load seed is sized (600k documents, no PDFs) with a disk estimate and an 8 GB abort, and removed afterwards; the weekly cron only logs; the sign-in rate limit exempts the gate user; paste 2 tags without checking out.
- Scope trimmed: no Realtime in Stage 1, no paid "explain" call, no debit notes, no 1280px journeys beyond the shell, nightly CI jobs on `workflow_dispatch` only, IMS/e-way/thresholds as prose; the bill's chosen format renders synchronously at issue so the done screen is on the golden path.
