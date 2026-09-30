# shellcheck shell=bash disable=SC2034
# Shared by the scripts in deploy/vm. Sourced, not run.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE=(docker compose -p ekbill -f "$REPO_DIR/deploy/docker-compose.yml")
PROJECT="${EKBILL_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
PROJECT="${PROJECT:-tariff-order-parsing}"
VM_NAME="${EKBILL_VM:-tariff-order}"
VM_ZONE="${EKBILL_ZONE:-asia-south2-b}"
BUCKET="${EKBILL_BACKUP_BUCKET:-${PROJECT}-ekbill-backups}"

say() { printf '\n== %s\n' "$*"; }

# A secret's latest value, or empty when it has none yet. Never echoed.
secret() {
  gcloud secrets versions access latest --secret="$1" --project="$PROJECT" 2>/dev/null || true
}

# The running container of one EkBill service (db, app, docling, caddy), found by compose's own
# labels. Scripts that only need to reach a running container use this with plain `docker`,
# because `docker compose -f ...` refuses to load the file without the secrets in the environment
# -- which is exactly the situation under cron.
container_of() {
  docker ps -q --filter "label=com.docker.compose.project=ekbill" --filter "label=com.docker.compose.service=$1" | head -1
}

# This VM's name, from the metadata server.
instance_name() {
  curl -fsS -H 'Metadata-Flavor: Google' 'http://metadata.google.internal/computeMetadata/v1/instance/name' 2>/dev/null || true
}

external_ip() {
  curl -fsS -H 'Metadata-Flavor: Google' \
    'http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip' \
    2>/dev/null || true
}

# The HTTPS name: EKBILL_DOMAIN if set (e.g. ekbill.aayuda.energy, with an A record to the VM),
# else deploy/vm/domain if present, else <ip-with-dashes>.sslip.io, which needs no DNS at all.
domain() {
  if [ -n "${EKBILL_DOMAIN:-}" ]; then echo "$EKBILL_DOMAIN"; return; fi
  if [ -s "$REPO_DIR/deploy/vm/domain" ]; then tr -d ' \n' < "$REPO_DIR/deploy/vm/domain"; return; fi
  local ip; ip="$(external_ip)"
  [ -n "$ip" ] && echo "${ip//./-}.sslip.io"
}
