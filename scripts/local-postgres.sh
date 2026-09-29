#!/usr/bin/env bash
# Start/stop a throwaway PostgreSQL 16 (+ pgvector) on port 5440 without Docker, for tests and
# local development.  Needs the postgresql-16 and postgresql-16-pgvector packages (Debian/Ubuntu).
# On the VM the database runs in Docker instead (deploy/docker-compose.yml).
set -euo pipefail
ACTION=${1:-start}
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DATA=${EKBILL_PGDATA:-/var/lib/postgresql/ekbill/data}
PORT=${EKBILL_PGPORT:-5440}
RUNAS=${PGUSER_OS:-postgres}

run_as() { if [ "$(id -u)" = "0" ]; then su "$RUNAS" -c "$*"; else bash -c "$*"; fi; }

case "$ACTION" in
  start)
    if [ ! -f "$DATA/PG_VERSION" ]; then
      mkdir -p "$(dirname "$DATA")"
      [ "$(id -u)" = "0" ] && chown "$RUNAS" "$(dirname "$DATA")"
      run_as "$PGBIN/initdb -D $DATA -A trust -U postgres" >/dev/null
    fi
    if ! "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then
      run_as "$PGBIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp' -l $(dirname "$DATA")/pg.log start" >/dev/null
    fi
    for _ in $(seq 1 40); do
      "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1 && break; sleep 0.25
    done
    for db in ekbill_test ekbill_dev; do
      psql -h 127.0.0.1 -p "$PORT" -U postgres -tc "select 1 from pg_database where datname='$db'" | grep -q 1 \
        || psql -h 127.0.0.1 -p "$PORT" -U postgres -c "create database $db" >/dev/null
    done
    echo "postgres ready: postgres://postgres@127.0.0.1:$PORT/ekbill_dev (tests use ekbill_test)"
    ;;
  stop) run_as "$PGBIN/pg_ctl -D $DATA stop" ;;
  *) echo "usage: $0 start|stop"; exit 2 ;;
esac
