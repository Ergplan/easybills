# Backup and restore

| What | Where | How |
| --- | --- | --- |
| Every business record, the search index, the audit trail | Postgres (`ekbill_pgdata` volume on the VM) | Nightly `pg_dump -Fc` to `gs://tariff-order-parsing-ekbill-backups/pg/`, kept 30 days (`deploy/vm/backup.sh`, cron 02:30 IST) |
| Sign-in accounts | Firebase Auth, project `ekbill-1918b` | Held by Firebase; only phone numbers, nothing about the books |
| Secrets | Secret Manager (`ekbill-*`) | Versioned by Secret Manager |
| Uploaded old bills | Not kept; only their text, which is in Postgres | — |
| Bill PDFs | Not stored; rendered from the issued record on demand | — |

## Restoring

The commands are in [deployment.md](deployment.md#backups-and-restoring-one). Always restore into
a new database first and count what came back. Only then replace the live one.

## Checking a backup is real

Once a month, restore last night's dump into `ekbill_restore` and compare:

```sql
select (select count(*) from invoices where status = 'issued') as issued,
       (select sum((data->'totals'->>'grandTotalPaise')::bigint) from invoices where status = 'issued') as billed_paise,
       (select count(*) from payments) as payments;
```

Run the same query on the live database. They should match up to the bills made since the dump.
