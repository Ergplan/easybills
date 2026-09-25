# Filing recovery runbook

What to do when a GST filing does not go cleanly. Written for whoever operates
this installation, not for the business owner.

**The rule that governs all of it: never resubmit without first asking what
happened.** A duplicate filing is harder to undo than a delayed one.

---

## Reading the state

| Status | What is true | Next |
|---|---|---|
| `draft` | Being prepared | Normal |
| `needs-review` | Findings outstanding | Owner resolves them |
| `ready` | Nothing blocking; approved | Submit, or export |
| `uploaded` | Sent, provider is processing | Poll status |
| `filed` | Acknowledged, matched to GSTIN + form + period | Done |
| `reported-filed-unverified` | The owner says they filed it | Verify against the portal |
| `failed` | Rejected, with errors recorded | Fix and re-approve |
| `status-unknown` | **We do not know** | Query before anything else |

---

## Scenario 1 — Timeout, outcome unknown

**Symptom.** `status-unknown`, attempt has `errors: [{ code: 'TIMEOUT' }]`.

This is the dangerous one. The submission may have succeeded.

1. **Do not resubmit.** The code already tried a status query before giving up.
2. Query the provider again with the same `idempotencyKey` from the attempt
   record. The key is derived from the version id and payload hash, so it is
   stable across retries.
3. If the provider now reports success, record the acknowledgement — validate it
   against the GSTIN, form and period first.
4. If the provider still does not know, check the GST portal directly for that
   GSTIN, form and period.
5. Only if the portal confirms nothing was filed may you resubmit. The same
   idempotency key makes that safe at the provider.

The period stays `status-unknown` until somebody establishes the truth. That is
correct: an unknown outcome recorded as unknown is a smaller problem than one
recorded as either success or failure.

## Scenario 2 — Schema rejection

**Symptom.** `failed`, errors carry a code and often a field path.

1. Read the field path in the attempt record. It points at the offending part of
   the payload.
2. Fix the underlying data — the invoice, the purchase, the mapping.
3. Re-prepare. The fingerprint changes, which invalidates the old approval.
4. The owner approves again, seeing the corrected figures.
5. Resubmit. A new payload hash means a new idempotency key, so this is
   correctly a new submission.

Never edit a payload to satisfy a schema without fixing the record behind it.
The return would then disagree with the books.

## Scenario 3 — Period already filed

**Symptom.** `failed` with `ALREADY_FILED`.

Somebody filed on the portal directly, or an earlier attempt succeeded and we
did not learn about it.

1. Confirm on the portal: get the acknowledgement number, form and period.
2. Record it as owner-attached evidence. It shows as
   *Reported filed — verification pending*.
3. Verify it against the portal and mark it verified.
4. If the filed return is **wrong**, do not try to refile. Use the legally
   available correction path for that form and period. Correcting a return does
   not rewrite the invoices behind it.

## Scenario 4 — Authorisation expired or revoked

**Symptom.** "You have not authorised filing through … for this GSTIN".

1. Check the consent record: `revokedAt`, `expiresAt`, and the environment —
   sandbox consent never authorises a production submission.
2. Have the owner grant consent again. Consent is per GSTIN and per environment
   by design.
3. Retry. Nothing was submitted, so there is nothing to reconcile.

## Scenario 5 — Approval no longer valid

**Symptom.** "What you approved is not what is about to be sent", or "This
approval is no longer valid".

Working as intended. Something behind the return changed after approval.

1. Re-prepare the period.
2. Show the owner what changed.
3. They approve again. A new payload hash follows.

An approval must never travel to a payload the owner did not see.

## Scenario 6 — "Already being submitted"

**Symptom.** A second submission is refused while one is in flight.

The single-flight lock, working. It expires after five minutes.

1. Wait, then re-check the period status.
2. If it is still locked after five minutes and nothing is running, the lock
   document at `filinglock__{gstin}__{form}__{period}` can be deleted — but
   check the attempt records first to be sure nothing is genuinely in flight.

## Scenario 7 — Acknowledgement does not match

**Symptom.** `failed` with `ACK_MISMATCH`.

The provider returned an acknowledgement for a different GSTIN, form or period.
This is serious: it suggests a routing or account problem at the provider.

1. **Do not record it.** The code already refused.
2. Capture the attempt record and the raw response.
3. Raise it with the provider before submitting anything else for that GSTIN.
4. Check on the portal whether anything was in fact filed.

## Scenario 8 — Provider unavailable

**Symptom.** "No GST filing provider is configured", or connection errors.

1. Nothing was submitted.
2. Use the accountant pack and file on the portal.
3. Record the acknowledgement afterwards as owner-attached evidence.

Filing through the portal is a first-class path, not a workaround. It is the
only path in this build.

---

## What is always preserved

Every attempt records the approved payload hash, the idempotency key, the
environment, who attempted it, both timestamps, the provider reference and the
verbatim errors. Approvals record the source fingerprint, the payload hash and
the rule-pack version. Acknowledgements record their source and whether they are
verified. Filed snapshots are immutable.

That is enough to answer, months later: what was sent, who approved it, what it
was computed from, and what came back.

---

## Things never to do

- Resubmit after a timeout without querying first
- Record a challan or payment receipt as proof of filing
- Mark owner-attached evidence verified without checking the portal
- Edit a filed return's snapshot — use the correction path for that form
- Reuse an approval for a changed payload
- Enable production filing to "test whether it works"
