# Staged acceptance report

**Date: 25 September 2026.** Read this before using EasyBills for real billing.

Every claim below is backed by a test that runs, or is marked as not done.
Screenshots are not treated as verification, and a test count is not treated as
correctness.

```
npm test        255 tests, 18 files, all passing
npm run e2e     27 browser checks at 360px, all passing
npm run build   succeeds
npm run typecheck  clean
```

| File | Tests |
|---|---|
| `unit/money.test.ts` | 13 |
| `unit/dates.test.ts` | 10 |
| `unit/tax-engine.test.ts` | 26 |
| `unit/recurrence.test.ts` | 17 |
| `unit/ai-mock.test.ts` | 6 |
| `unit/gst-returns.test.ts` | 48 |
| `unit/qrmp.test.ts` | 13 |
| `integration/issuance.test.ts` | 13 |
| `integration/tenancy.test.ts` | 4 |
| `integration/payments.test.ts` | 9 |
| `integration/adjustments.test.ts` | 10 |
| `unit/setup-status.test.ts` | 7 |
| `integration/reconciliation.test.ts` | 5 |
| `integration/boundaries.test.ts` | 17 |
| `integration/recurrence.test.ts` | 13 |
| `integration/pdf.test.ts` | 9 |
| `integration/gst-flow.test.ts` | 12 |
| `integration/filing.test.ts` | 17 |

Integration tests run against the Firebase emulator suite, not mocks.

---

## Summary

| Stage | State |
|---|---|
| 1 — Manual billing foundation | Gates met |
| 2 — Dependable invoices and collections | Gates met |
| 3 — Monthly drafts | Gates met |
| 4 — Text-to-draft AI | Gates met with the mock adapter. **No live provider exercised** |
| 5 — Voice and hardening | Implemented; **not tested on real mobile devices** |
| 6 — GST preparation | Gates met. **Return readiness blocked by design: no tax rule verified** |
| 7 — Connected filing | Sandbox gates met. **Production filing unavailable — no provider access** |

---

## Stage 1 — Manual billing foundation

**Gate: create and recover a draft end to end.** Met.
`integration/issuance.test.ts` creates a draft, reloads it, and asserts the
lines and totals survive. The browser smoke test does the same through the UI
and confirms autosave reaches "Saved".

**Gate: two test businesses cannot access each other's records.** Met.
`integration/tenancy.test.ts` creates two businesses and asserts one cannot read
the other's invoices or customers, that membership documents do not cross, and
that numbering is independent. Isolation is structural: records live under
`businesses/{id}`, and `firestore.rules` denies all direct client access.

**Gate: the 360px view is usable.** Met. The smoke test runs the whole journey
at 360px and asserts zero horizontal overflow and every visible touch target at
least 44px. This failed on the first run and found four controls between 32px
and 40px, now fixed.

**Gate: no unnecessary setup screens.** Met. Only the business name is required
before drafting. GST status, numbering and bank details are collected before the
first *issue*, not the first draft.

## Stage 2 — Dependable invoices and collections

**Gate: known calculation fixtures match.** Met. `unit/tax-engine.test.ts`
covers the brief's worked example (two visits at 800 plus parts of 450 =
**2,050 before tax**), intra-state CGST/SGST splitting, interstate IGST, UTGST
for Union Territories without a legislature, tax-inclusive pricing, line
discounts, cess as a separate head, rate-wise grouping and rupee round-off.
`unit/money.test.ts` pins the rounding policy and confirms `0.1 + 0.2 === 0.3`
in paise.

**Gate: concurrent issue or retry gives one invoice.** Met. Ten simultaneous
`issueInvoice` calls on one draft produce exactly one allocation and one number;
the rest observe the issued invoice and return it unchanged.

**Gate: issued history unchanged after profile edits.** Met. A test issues an
invoice, then changes the business name, address, GSTIN and state, and asserts
the issued snapshot is untouched.

**Gate: payment reversals preserve audit history.** Met. The original payment
row survives, marked as reversed, with a mirror row beside it and an audit
event. Overpayment is rejected at allocation and retained as visible unapplied
credit; a settlement deduction reduces the balance without counting as cash or
changing the invoice total.

**Gate: basic adjustments.** Met. `integration/adjustments.test.ts` covers
credit and debit notes: each has its own number sequence within the financial
year, each is refused against a draft or without a reason, a credit note cannot
exceed the bill it corrects, and the issued invoice's total, number and snapshot
are untouched throughout. Crucially, *correcting a customer's balance* and
*changing GST liability* are separate assertions — `affectsTaxLiability` is an
explicit, owner-confirmed field, and a note raised without it carries no tax
split at all. Reason, actor and time are audited.

**Gate: PDF readable across single and multipage examples.** Met. Three-line and
45-line invoices both render; the long one is asserted to span more than one
page. The template escapes all user content, rejects a logo that is not a plain
image data URL, and the renderer blocks all network requests. The rendered
output was also inspected visually.

**Gate: unsupported cases cannot issue.** Met. Export, SEZ, deemed export,
reverse charge, advance receipt and exempt supplies are each refused, as are
composition and unconfirmed GST status — and the draft survives every refusal.

## Stage 3 — Monthly drafts

**Gate: 31st dates, February, leap years, financial-year rollover.** Met.
`unit/recurrence.test.ts` and `unit/dates.test.ts` assert a 31st anchor lands on
28 or 29 February and **returns to the 31st**, that 2024 uses 29 February, and
that April–March boundaries behave.

**Gate: concurrent workers, zero duplicate occurrences.** Met. Eight concurrent
`runSchedule` calls produce exactly one occurrence and one draft. This is
enforced by the database refusing the second write to a deterministic document
id, not by checking first.

**Gate: outage catch-up.** Met. A schedule three months behind produces four
separate drafts, each with its own billing period, all flagged as catch-up, all
drafts. Catch-up is bounded to twelve periods.

**Gate: skipped periods, one-invoice versus future edits.** Met. A skipped month
is not recreated on resume; skipping a month whose draft already exists is
refused; "this and future" bumps the template version, keeps the previous one in
history, and leaves the already-created draft on the old agreed amount.

**Gate: no automatic sending or payment collection.** Met by construction. The
worker only creates drafts.

## Stage 4 — Text-to-draft AI

**Gate: correct interpretation of fixture instructions.** Met with the mock
adapter. `unit/ai-mock.test.ts` covers the brief's three examples, including the
Hindi "Ravi ko teen service visits, har visit 700 rupaye".

**Gate: ambiguous customers and missing prices trigger review.** Met. Multiple
matches become a question; a missing price stays missing and is listed.

**Gate: prompt injection cannot mutate records or reach another business.** Met
by construction and asserted. The output schema has no field capable of holding
a record id, a query or a command; the instruction is wrapped in an explicit
data envelope; customer resolution happens server-side within the caller's own
business, and an id not in that business's list is not honoured.

**Gate: the server recalculates amounts.** Met. Quantities and quoted amounts
are re-parsed by our own parser; an amount stated as a line total is converted
to a unit price by our arithmetic, not the model's.

**Gate: failure preserves the manual draft.** Met. Proposals append to existing
lines; timeout, malformed output, throttling and provider failure each return a
message and leave the form alone.

**Not done: a live provider smoke check.** No API key was available. The
Anthropic, OpenAI and Google adapters are implemented against their structured
output APIs but **have not been called**. Treat them as unverified.

## Stage 5 — Voice and hardening

**Gate: manual billing works without AI.** Met. `AI_ENABLED=false` removes the
feature; nothing else depends on it.

**Gate: core end-to-end tests pass.** Met.

**Implemented:** visible record and stop controls, microphone permission on
demand, transcript shown for review and editing before use, cancel, and a
fallback to typing on permission denial or unsupported recording. Audio is
streamed to the provider and never stored. Accessibility: 44px targets, visible
labels, AA-contrast tokens in both themes, focus rings, `prefers-reduced-motion`,
pinch-zoom left enabled, no state conveyed by colour alone.

**Not done honestly:**
- **No testing on real mobile devices or browsers.** Chromium at 360px is not a
  phone. Android Chrome, iOS Safari and real network conditions are untested.
- **No English/Hindi/mixed-language trials with real speech.** The mock
  transcription adapter cannot hear, and says so rather than fabricating a
  transcript. No claim is made about language support.
- No screen-reader testing.
- Interrupted recording and slow-network behaviour are implemented but untested
  on a real device.

## Stage 6 — GST preparation

**Gate: fixtures reconcile to expected tables and tax heads.** Met.
`integration/gst-flow.test.ts` issues sales, imports purchase and GSTR-2B
fixtures, and asserts B2B and B2C separation, interstate tax landing in IGST,
and per-head figures.

**Gate: duplicate imports do not inflate turnover or credit.** Met. Caught at
two levels — the file hash, and a per-row supplier-plus-document key, so the
same bill in two different files is still skipped.

**Gate: nil-sales with purchases cannot become a false nil return.** Met. No
sales plus purchases blocks; nothing at all blocks until the owner explicitly
confirms they had no business.

**Gate: ineligible ITC is not claimed automatically.** Met. An unreviewed bill
contributes zero; readiness is blocked while any bill is undecided; ineligible,
blocked and deferred all contribute zero even with figures present. A test
asserts that a GSTR-2B row marked available changes nothing.

**Gate: stale statements and unsupported liabilities block readiness.** Met.
Missing, wrong-period, superseded and stale statements each block, as does
reverse-charge liability.

**Gate: IFF records do not duplicate quarterly sales.** Met.
`unit/qrmp.test.ts` asserts that documents furnished through IFF in the first
two months are excluded from the quarterly return, that exclusion is keyed to
the month they were furnished for, and that the totals across IFF and the
quarterly return sum to the true turnover rather than double-counting. It also
pins the QRMP obligation shape: months 1 and 2 file nothing but are still
payment months.

**Gate: post-review changes invalidate approval.** Met. Approval is bound to a
fingerprint over every source record; changing one purchase moves the
fingerprint and invalidates the approval. Reordering records does not.

**Gate: exported payloads pass official schema validation.** **Not done, and not
possible here.** No schema version is verified, so **no upload file is
produced**. The accountant pack is plainly labelled as workings, not as a
portal-ready payload. Inventing an upload format would be worse than offering
none.

**Gate: daily billing remains as simple as Stage 5.** Met. The module is hidden
from unregistered businesses; registrants get one Home card; the three
navigation destinations are unchanged; no tax table reaches a billing screen.

**Blocking limitation:** with no rule verified, `assessReadiness` returns the
`rules-unverified` blocker, so **no period can be declared ready in this build**.
That is the designed behaviour, and it is why the module is honest rather than
finished. See [compliance/README.md](compliance/README.md).

## Stage 7 — Connected filing

**Gate: expired authorisation handled safely.** Met — expired and revoked
consent both refuse, and sandbox consent does not authorise production.

**Gate: schema rejection.** Met — recorded as failed with the error and field
path, never as filed.

**Gate: timeout with unknown outcome.** Met — a status query is attempted, and
failing that the period is recorded `status-unknown`. No blind resubmission.

**Gate: repeated button taps.** Met — five simultaneous submissions produce one
filing and one acknowledgement. Building this found a real defect: repeated
submissions each wrote their own acknowledgement. Fixed by making the
acknowledgement id deterministic.

**Gate: already-filed periods.** Met — reported, not refiled.

**Gate: wrong-GSTIN/period acknowledgements fail validation.** Met — mismatched
GSTIN, form, period or a blank reference all rejected.

**Gate: approval cannot be reused for a changed payload.** Met — the submission
carries the approved payload hash and refuses if the version's hash has moved.

**Gate: production capability separately labelled unverified.** Met.
`describeFilingCapability()` returns `productionVerified: false`, and the UI
tells the owner filing from inside the app is unavailable. With no credentials
the adapter **refuses rather than quietly using the sandbox**. No live filing or
payment was attempted at any point.

---

## Usability pass, 25 September 2026

A structured walkthrough of the protocol's tasks was run against a fresh
account with no seeded data, interacting only through visible controls.
**This is not a substitute for testing with real owners** — it was run by the
same author who wrote the application, so it cannot measure discoverability for
someone encountering it cold. [usability-protocol.md](usability-protocol.md)
remains outstanding.

Interactions were counted rather than timed, because an automated click is not
a human's speed.

| Task | Before | After |
|---|---|---|
| Sign-up to usable Home | 6 | 6 |
| First invoice | 15, **8 wasted** | **13, none wasted** |
| Walk-in bill, paid cash | 10 | 10 |
| Duplicate and adjust | 6 | 6 |
| Monthly schedule | 5 | 5 |
| Interrupted draft to part payment | 11 | 11 |

Seven defects were found and fixed:

1. **A red error on an untouched form.** Requiring at least one line to *save*
   meant autosaving an empty draft failed, and the failure rendered in the
   save-status slot as "Add at least one item" before the owner had typed
   anything. Drafts may now be incomplete; the rule is enforced at issue time,
   where it already was.
2. **The first-issue wall cost eight interactions.** The GST-status requirement
   surfaced only at review, after the bill was written, and Settings offered no
   way back. The editor now warns before any work, and Settings carries a
   "Back to your bill" link.
3. **The Home setup banner never cleared.** It keyed off `numberingConfirmed`,
   which nothing in the billing flow sets, so it kept telling owners who had
   issued several bills to finish setting up. Home and the editor now both ask
   the same question issuance asks, through `profileSetupStatus`.
4. **The assistant silently dropped what it could not parse.** "...and some
   lining material" vanished with no warning, producing a bill missing an item.
   Two causes: the parser discarded unmatched fragments, and the pipeline's
   "please check this" notes were computed and never rendered. Both fixed; the
   unit tests had covered the pipeline but not the wiring.
5. **Duplicate customer choices** during assistant disambiguation.
6. **Environment variable names shown to owners.** The provider's unavailable
   reason is now split into an owner sentence and an operator detail.
7. **Operator jargon and nine stacked notices** on the GST screen.

---

## Functional testing, 25 September 2026

Weighted towards the gap the usability pass exposed: logic that is correct but
never wired to anything, and boundaries that unit tests structurally cannot
reach.

**Wiring audit.** Every field produced by a server module was cross-checked
against what the UI reads. Of 381 fields, 185 are never referenced; most are
legitimately internal (audit rows, job-queue bookkeeping, filing internals).
Four were real gaps, all now fixed: the assistant's schedule-change intent was
detected and discarded, proposed and uncertain values were not marked,
`needsDateReview` was exported and never called, and a regression from the
previous commit could leave the editor with no row to type into.

That audit left one gap open, now closed. See **GSTR-1 drill-down** below.

**Authorization at real HTTP boundaries.** Two unrelated businesses, both
signed in, attacking each other's endpoints: the PDF route with the victim's
business id and with the attacker's own, the GST pack route, the job runner
with no secret and a wrong secret, the transcription route against another
business's budget, and the bill page by URL — plus the same set signed out.
All refused. Repository-level isolation was already tested; this covers the
surface a browser can actually reach.

**Money reconciliation.** The ledger invariant — balance = total + debit notes
− credit notes − payments − deductions — is asserted after *every* operation
through a full lifecycle: part payment, debit note, credit note, TDS-style
deduction, settlement, reversal. The issued document is unchanged throughout.
Separately, the GST return's outward tax is asserted equal to the tax on the
invoices it was built from, across intra-state, inter-state and several rates,
and a draft contributes nothing.

**Adversarial input.** Amounts past exact integer arithmetic are refused rather
than silently wrong; a 99,999,999.99 line prices exactly; negatives are
refused; 100 lines of half-paise round per line and sum to the stored total;
`1e9`, `Infinity`, `NaN`, `0x10` are rejected rather than coerced; Devanagari,
Tamil, Arabic and CJK names survive to the document; over-long descriptions and
300-line bills are refused; malformed dates are refused rather than guessed;
bad CSV rows are reported individually with row numbers; a 200-line bill prices
and renders without drift.

Hostile text was tested by rendering the document in a real browser and
counting live script elements and event handlers — zero — rather than by
substring matching, which had produced a false positive on escaped text that
merely *reads* like a handler.

Two of the failures in this round were my own bad assertions, not defects, and
were corrected rather than the code being changed to match them.

**GSTR-1 drill-down.** The outward tables were computed and exported but not
viewable, so an owner asked to approve a return had to take the totals on
trust. Step 1 now carries a *See every sale behind these figures* disclosure:
sales to registered customers grouped by customer with each document linking to
its bill, the unregistered summary expandable per state and rate into the bills
behind it, credit and debit notes, the HSN summary, the numbers used, and a
reconciling total. Rows built from a CSV or portal import say so instead of
offering a link that would go nowhere.

Building it exposed a second defect. Items with no HSN code all fall into one
summary group, and the row was named after whichever item was seen first — a
month of four cement bags and two tins of paint reported as "Paint tins, qty
6". The row now carries every distinct description and states how many it is
not showing, in the app and in the accountant pack alike.

Verified in a real browser at 360px (`npm run e2e:gst`): the links reach the
bills they name, every target clears 44px, nothing overflows, no client errors.

**A rate nobody chose.** That run also exposed a defect in issuance itself: a
regular-GST business could issue a Tax Invoice with the rate select left empty.
The editor said "We do not guess the rate," but nothing enforced it — an empty
rate was coerced to 0 bp, so the bill printed 0%, charged no GST, and entered
GSTR-1 as a nil-rated supply.

The rate could not be judged by its value, because 0% is a legal answer: an
unanswered select and a deliberate nil-rated supply both read as zero. Lines
now carry whether the owner answered, derived on the server from the rate field
the client sent rather than accepted as a separate claim, and issuance refuses a
bill with an unanswered rate while still allowing a deliberate 0%. The review
preview prints "not chosen" rather than "0%", and a rate saved as 0% now comes
back as 0% in the editor instead of an empty select. Lines written before the
flag existed count as answered, so no issued bill is retrospectively failed.

**Return output is now order-independent.** The GSTR-1 tables were built by
walking the query's result order, so the same period could render its rows — and
the item names inside a grouped row — differently on each refresh. The
documents are sorted by date, then number, then rate before any table is built.

---

## Everything that is mocked or unverified

| Thing | State |
|---|---|
| GST legal parameters (11 values) | **All unverified.** Official domains unreachable from the build environment. Dependent features block or degrade |
| GST return readiness | **Blocked by design** while rules are unverified |
| Connected GST filing | **Unavailable.** Sandbox only; no provider contract or credentials |
| Portal upload file | **Not produced.** No verified schema version |
| AI language providers | **Never called.** Implemented, untested against a live API |
| Speech transcription | **Never called.** The mock says it cannot hear rather than inventing a transcript |
| Ledger balances | **Never imported.** Cash figures are labelled provisional |
| Real mobile devices | **Untested** |
| Human usability testing | **Not done.** Protocol ready in [usability-protocol.md](usability-protocol.md) |
| GST practitioner review | **Not done.** This is a launch gate |
| Email/WhatsApp delivery | **Deliberately absent.** The app never claims a bill was sent |
| Backup restore verification | **Not performed.** Procedure in [backup-restore.md](backup-restore.md) |

## Production blockers

1. Verify every rule-pack value, dated and attributed. Until then no GST return
   can be declared ready.
2. Obtain a GST practitioner's review of the return workflows.
3. Obtain GSP access, implement the provider adapter against a real API, and
   exercise the sandbox fully before enabling production.
4. Configure and exercise a real AI provider, or ship with AI disabled.
5. Test on real Android and iOS devices, including the voice path.
6. Run the usability protocol with 8–10 owners.
7. Perform and record a backup restore, including the counter check.
8. Decide and configure data retention.

## Known weaknesses

- **QRMP is unit-tested but has no end-to-end run.** The quarter maths, the
  obligation shape and IFF de-duplication are covered directly; a full
  three-month quarterly preparation has not been exercised against the database.
- **GSTR-1A and IMS are not implemented.** Correction paths beyond credit and
  debit notes are absent.
- **Reconciliation matching is conservative by design.** It will produce false
  "missing" findings where a supplier writes a number very differently. That is
  the intended trade: a false mismatch costs a minute, a false match costs a
  wrong return.
- **Firestore composite indexes** are not committed. The first run against a
  real project will prompt for them.
- **The bill list filters in the application**, which is fine at small-business
  scale and would not be at larger scale.
