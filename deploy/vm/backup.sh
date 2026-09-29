#!/usr/bin/env bash
# Dump the EkBill database to the backup bucket. Run nightly from cron (setup.sh installs it).
#   restore: see docs/deployment.md, "Restoring a backup".
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

stamp="$(date -u +%Y%m%d-%H%M%S)"
object="gs://$BUCKET/pg/ekbill-$stamp.dump"
# Custom format: compressed, and pg_restore can pick tables out of it.
"${COMPOSE[@]}" exec -T db pg_dump -U ekbill -d ekbill -Fc | gcloud storage cp - "$object" --project="$PROJECT"
echo "backup written: $object"
