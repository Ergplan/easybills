# Backup and restore

Invoices are records a business may need years later, and a tax authority may
ask for. Losing them is not a degraded experience; it is a failure.

---

## What must survive

| Data | Where | Why |
|---|---|---|
| Businesses, members | `businesses/*`, `businesses/*/members/*` | Who owns what |
| Customers, saved items | `businesses/*/customers`, `/items` | Rebuilding billing |
| **Invoices** | `businesses/*/invoices` | The records themselves, with their issued snapshots |
| **Payments, adjustments** | `/payments`, `/adjustments` | What was actually collected |
| **Counters** | `/counters` | Number sequences and reservations. Losing these risks reissuing a number |
| Schedules, occurrences | `/schedules`, `/occurrences` | Monthly billing, and which periods are done |
| Audit events | `/auditEvents` | Who did what, when |
| GST records | `/supplierBills`, `/gstStatementSnapshots`, `/returnPeriods`, `/returnVersions`, `/filingAttempts`, `/filingAcknowledgements`, `/providerConsents` | Return history and filing evidence |
| Auth users | Firebase Auth | Sign-in. Exported separately from Firestore |

PDFs are **not** backed up, and do not need to be: they are rendered on demand
from the invoice's own snapshot, so the same bytes can always be reproduced.

---

## Taking a backup

### Scheduled exports

```bash
gcloud firestore export gs://your-backup-bucket/$(date +%Y-%m-%d) \
  --project=your-project
```

Schedule it daily. Firestore exports are consistent to a point in time.

### Auth users

```bash
npx firebase auth:export users-$(date +%Y-%m-%d).json --project your-project
```

Keep this beside the Firestore export from the same day. Restoring one without
the other leaves records nobody can sign in to reach.

### Where backups go

- A bucket **not** writable by the application's service account, so a
  compromise of the app cannot destroy the backups.
- Object versioning on, with a retention policy.
- Encrypted at rest, access logged.
- **Not** in the same failure domain as the live project.

---

## Restoring

```bash
gcloud firestore import gs://your-backup-bucket/2026-09-25 --project=your-project
npx firebase auth:import users-2026-09-25.json --project your-project
```

Restore into a **fresh project first**, verify, then decide. Importing over a
live project merges documents and can resurrect deleted ones.

---

## Verifying a restore — do this before production

A backup you have never restored is a hypothesis. Verify it on representative
invoice and payment data, and repeat the exercise on a schedule.

1. Restore into a scratch project.
2. Point a local app at it (`FIREBASE_PROJECT_ID`, credentials; emulator
   variables unset).
3. Check, against known values from the live system:
   - [ ] An issued invoice opens, with its **number, totals and issued snapshot**
         intact — seller name, address and GSTIN as at issue, not as they are now
   - [ ] Its PDF renders and matches what the customer received
   - [ ] Payments and reversals are present, and the balance recomputes correctly
   - [ ] `businesses/{id}/counters` holds the right next number, and the
         `issued__{fy}__{number}` reservations are there
   - [ ] Issuing a new invoice produces the **next** number, not a repeat
   - [ ] Two businesses are still separate: neither can see the other's records
   - [ ] Monthly schedules show the right next date, and past occurrences are
         present so catch-up does not re-create them
   - [ ] GST periods keep their status, approvals and acknowledgements
   - [ ] A restored user can sign in
4. Record the date, the backup used, and the result.

Step 5 is the one people skip and regret: **issue an invoice in the restored
project and confirm it gets the next number.** If counters were lost, this is
where you find out, rather than after a customer receives a duplicate.

---

## Recovery objectives

Set these deliberately.

| | Suggested | Meaning |
|---|---|---|
| RPO | 24 hours | Daily exports; up to a day of records could be lost |
| RTO | 4 hours | Restore, verify, repoint |

Daily exports mean a day of invoices could vanish. If that is unacceptable, take
exports more often and say so here.

---

## Partial loss

**One invoice deleted.** Issued invoices are never deleted by the app, so this
means direct database access. Restore that document from the most recent export
and check its counter reservation still exists.

**Counters lost or wrong.** Do not guess. Read the highest `numberSequence` on
any issued invoice for the financial year, set `nextNumber` above it, and
reconstruct the `issued__{fy}__{number}` reservations from the invoices
themselves. Never reuse a number that has been issued.

**A whole business.** Restore its subtree into a scratch project first, verify
as above, then copy it back.

---

## Retention

Business records have statutory retention periods. Decide yours deliberately,
write it here, and configure lifecycle rules to match — do not let it default to
whatever the bucket does.

Deletion requests from a person do not override a legal obligation to retain
business records. Take advice before deleting anything a tax authority may ask
for.
