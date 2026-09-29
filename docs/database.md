# The database

Every business record lives in PostgreSQL 16 (with pgvector for search). Firebase is used
only for phone sign-in.

## Where it runs

| Where | How |
| --- | --- |
| The VM | the `db` service of `deploy/docker-compose.yml`, data in the `ekbill_pgdata` volume, dumped nightly to `gs://<bucket>/pg/` |
| Your machine / CI | `scripts/local-postgres.sh start` (port 5440, databases `ekbill_dev` and `ekbill_test`) |

The app finds it through `DATABASE_URL`. There is no default in production.

## Schema

`db/migrations/*.sql`, applied in order by `node db/migrate.mjs` (the app container runs it on
start, under an advisory lock). A migration is never edited once it has run anywhere; changes go
in a new file.

Each table keeps the full record in `data jsonb` -- the shapes in `src/lib/domain/types.ts` -- and
every field the app filters, sorts or enforces a rule on is a **generated column** derived from it.
There is one write per change and Postgres derives the rest, so a column can never disagree with the
record it came from.

| Rule | Enforced by |
| --- | --- |
| A record belongs to exactly one business | `business_id not null references businesses on delete cascade`, and every helper in `src/server/db/docs.ts` takes the business id |
| A bill number is used once per business per year, cancelled bills included | `unique (business_id, financial_year, number)` on `invoices` |
| A credit/debit note number is used once per year | `unique (business_id, kind, financial_year, number)` on `adjustments` |
| Two issues of one draft allocate one number | the draft row and the business row are locked (`select ... for update`) inside one transaction |
| A double-tapped payment or note is recorded once | the id is derived from a client-fixed key; the loser of an insert race hits the primary key, retries, and reads the winner's row (`withTx`) |
| Balances match their payments | payments, notes and the bill's balance are written in the same transaction, with the bills locked in id order |
| The audit trail is append-only | nothing in the app updates or deletes `audit_events`; rows written inside a transaction commit or roll back with the change |

Money is integer paise in the records (`bigint` when summed in SQL), never `numeric` or `float`.

## Useful queries

```sql
-- Bills to one customer, newest first
select data->>'number', issue_date, (data->'totals'->>'grandTotalPaise')::bigint / 100.0 as rupees
from invoices where business_id = $1 and customer_id = $2 and status = 'issued' order by issue_date desc;

-- What is owed, by customer
select data->'customer'->>'name', sum((data->>'balancePaise')::bigint) / 100.0
from invoices where business_id = $1 and status = 'issued' group by 1 order by 2 desc;
```

## Not moved from Firestore

GST return filing, supplier-bill import and monthly recurring bills had no screen in the rebuilt
app and were left behind in the move (they remain in git history before this change). The pure
logic in `src/lib/gst-returns` is kept and tested; a screen that needs it again brings its tables
with it as a new migration.
