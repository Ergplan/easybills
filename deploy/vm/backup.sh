#!/usr/bin/env bash
# Dump the EkBill database to the backup bucket. Run nightly from cron (setup scripts install it),
# and by deploy/vm/handover.sh before moving to another VM.
#   restore: deploy/vm/restore.sh (see docs/deployment.md)
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

db="$(container_of db)"
[ -n "$db" ] || { echo "The EkBill database container is not running; nothing to back up."; exit 1; }

stamp="$(date -u +%Y%m%d-%H%M%S)"
object="gs://$BUCKET/pg/ekbill-$stamp.dump"
# Custom format: compressed, and pg_restore can pick tables out of it. pipefail (lib.sh) makes a
# failed dump fail the backup instead of uploading an empty file.
docker exec -i "$db" pg_dump -U ekbill -d ekbill -Fc | gcloud storage cp - "$object" --project="$PROJECT"
size="$(gcloud storage ls -l "$object" --project="$PROJECT" | awk 'NR==1{print $1}')"
[ "${size:-0}" -gt 1000 ] || { echo "The backup at $object is suspiciously small (${size:-0} bytes). Check it."; exit 1; }
echo "backup written: $object (${size} bytes)"
