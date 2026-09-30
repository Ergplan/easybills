#!/usr/bin/env bash
# Load a backup from the bucket into this VM's EkBill database.
#
#   deploy/vm/restore.sh                      # the newest backup, into an empty database
#   deploy/vm/restore.sh latest --replace     # the newest, over a database that has bills in it
#   deploy/vm/restore.sh gs://.../ekbill-20260930-120000.dump
#
# Used to move EkBill to another VM (after deploy/vm/handover.sh on the old one) and to recover.
# It refuses to overwrite a database that already has businesses in it unless told --replace.
# The app is stopped while the restore runs, so nothing writes half-way through.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

src="${1:-latest}"
replace="${2:-}"
if [ "$src" = "latest" ]; then
  src="$(gcloud storage ls "gs://$BUCKET/pg/" --project="$PROJECT" | grep '\.dump$' | sort | tail -1)"
fi
[ -n "$src" ] || { echo "No backup found in gs://$BUCKET/pg/."; exit 1; }
echo "backup: $src"

say "Database"
db="$(container_of db)"
if [ -z "$db" ]; then
  # First start on this VM: bring up only the database. Compose needs every variable in the file
  # to load it, so the ones only Caddy uses get placeholders; Caddy is not started here.
  EKBILL_DB_PASSWORD="$(secret ekbill-db-password)"
  [ -n "$EKBILL_DB_PASSWORD" ] || { echo "ekbill-db-password has no value, or this VM cannot read it."; exit 1; }
  export EKBILL_DB_PASSWORD EKBILL_DOMAIN=unused EKBILL_GATE_HASH=unused
  "${COMPOSE[@]}" up -d --no-build db
  db="$(container_of db)"
fi
for _ in $(seq 1 60); do
  docker exec "$db" pg_isready -U ekbill -d ekbill >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$db" pg_isready -U ekbill -d ekbill >/dev/null || { echo "The database did not come up."; exit 1; }

existing="$(docker exec "$db" psql -U ekbill -d ekbill -tAc "select count(*) from businesses" 2>/dev/null || echo 0)"
if [ "${existing:-0}" != "0" ] && [ "$replace" != "--replace" ]; then
  echo "This database already has ${existing} business(es). Not overwriting it."
  echo "To replace it with the backup: deploy/vm/restore.sh ${1:-latest} --replace"
  exit 1
fi

say "Restoring"
app="$(container_of app)"
[ -z "$app" ] || { docker stop "$app" >/dev/null && echo "app stopped for the restore"; }
# --clean --if-exists: drop what the backup brings back, so it lands on a fresh or a used database alike.
gcloud storage cp "$src" - --project="$PROJECT" | docker exec -i "$db" pg_restore -U ekbill -d ekbill --no-owner --clean --if-exists
echo "restored: $(docker exec "$db" psql -U ekbill -d ekbill -tAc "select count(*) from businesses") business(es), $(docker exec "$db" psql -U ekbill -d ekbill -tAc "select count(*) from invoices") bill(s)"

echo
echo "Now start EkBill: EKBILL_NO_BUILD=1 deploy/vm/up.sh   (or deploy/vm/up.sh to build first)"
