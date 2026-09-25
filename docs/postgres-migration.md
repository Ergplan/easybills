# Moving from Firestore to PostgreSQL

Firestore was chosen for the MVP. This is the path to PostgreSQL when it is
wanted, and the things to be careful about.

---

## Why it is not a big rewrite

Data access is already behind a repository layer. Route handlers, server actions
and components never touch Firestore directly — they call `src/server/repos/*`
and `src/server/gst/repo.ts`. Swapping the implementation behind those functions
is the bulk of the work.

Everything in `src/lib/` — money, dates, the tax engine, reconciliation, return
workings, readiness — is pure logic with no database dependency at all. None of
it changes, and its tests carry over untouched.

---

## What Firestore is doing that a schema must keep doing

This is the part worth attention. Several invariants are currently enforced by
*document identity* rather than by constraints, and they must not be lost in
translation.

| Invariant | Firestore now | PostgreSQL |
|---|---|---|
| One occurrence per schedule per period | Document id `{scheduleId}__{period}`; `create()` fails if taken | `UNIQUE (schedule_id, period)` |
| One invoice number per business per year | Counter document plus a reserved `issued__{fy}__{number}` document | `UNIQUE (business_id, financial_year, number)` |
| One return period per GSTIN, form and period | Document id `{gstin}__{form}__{period}` | `UNIQUE (business_id, gstin, form, period)` |
| One acknowledgement per return | Document id `ack__{gstin}__{form}__{period}` | `UNIQUE (business_id, gstin, form, period)` |
| Tenant isolation | Records nested under `businesses/{id}`; a query cannot omit it | `business_id NOT NULL` on every table, plus row-level security |
| Atomic issuance | One `runTransaction` | One `BEGIN … COMMIT`, `SERIALIZABLE` or explicit row locks |

The nesting deserves particular care. Today "which business owns this record?"
is a property of the document **path**, so a query that forgets the tenant
cannot be written. In a relational schema that becomes a `WHERE` clause somebody
can forget. Use row-level security keyed on a session variable so the database
enforces it, rather than relying on every query being correct.

---

## Types

| Current | PostgreSQL |
|---|---|
| Money (integer paise) | `BIGINT`. **Not** `NUMERIC`, **not** `MONEY`, and certainly not `FLOAT` |
| Quantity (integer milli-units) | `BIGINT` |
| Rate (integer basis points) | `INTEGER` |
| Civil date (`"YYYY-MM-DD"`) | `DATE` |
| Timestamps (ISO strings) | `TIMESTAMPTZ` |
| Month period (`"YYYY-MM"`) | `CHAR(7)`, or a `DATE` pinned to the first of the month |
| Embedded arrays (invoice lines) | Either a child table or `JSONB` |

Keep money as integer minor units. The whole arithmetic layer depends on it, and
moving to `NUMERIC` would mean re-verifying every rounding decision for no gain.

Invoice lines are embedded today and are always read with their invoice. `JSONB`
preserves that and keeps the issued snapshot atomic; a child table gives better
reporting. If you split them out, the **issued snapshot must still be
immutable** — that is the property that makes history trustworthy.

---

## Suggested order

1. Define the schema with the constraints above. Write them first; they are the
   specification.
2. Reimplement `src/server/repos/*` against it, one module at a time.
3. Run the existing integration tests against PostgreSQL. They assert behaviour,
   not storage: concurrent issuance producing one invoice, reversals preserving
   history, occurrence uniqueness under eight concurrent workers. If they pass,
   the invariants survived.
4. Migrate data: export Firestore, transform, load. Take particular care with
   counters — see [backup-restore.md](backup-restore.md).
5. Reconcile: every invoice, every number, every payment, and the balances.
6. Keep Firebase Auth. It is a managed authentication provider and has nothing
   to do with where records live. Only the `users` mirror table moves.

---

## Things that will bite

**Counters.** Firestore's transactional counter becomes a sequence or a locked
row. A plain PostgreSQL `SEQUENCE` will not do on its own, because sequences are
not transactional — a rolled-back transaction leaves a gap, and invoice numbers
must not have unexplained gaps. Use a counter row with `SELECT … FOR UPDATE`.

**The lease-based job queue.** Straightforward with `FOR UPDATE SKIP LOCKED`,
and better than the current implementation.

**`ignoreUndefinedProperties`.** Firestore is configured to drop `undefined`.
PostgreSQL will not; audit every write for fields that are currently allowed to
vanish silently.

**Query shapes.** Some current queries fetch and filter in the application
because Firestore cannot express them (bill search, for instance). Those become
real SQL, which is an improvement — but check the results match before trusting
them.

**Dates.** Civil dates must stay civil. Storing them as `TIMESTAMPTZ` would
reintroduce exactly the timezone problem `src/lib/dates` exists to avoid. Use
`DATE`, and keep conversion at the edges.
