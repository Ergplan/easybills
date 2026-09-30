#!/usr/bin/env bash
# On the OLD VM, when moving EkBill to its own VM: stop taking changes here and write the final
# backup the new VM restores. The database keeps running and nothing is deleted, so going back is
# one command (EKBILL_NO_BUILD=1 deploy/vm/up.sh). See docs/own-vm.md.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

say "Hand EkBill over to the new VM"
echo "This stops EkBill's app and web front on $(instance_name) (the database stays, nothing is"
echo "deleted) and writes a final backup to gs://$BUCKET/pg/. The old address stops answering."
read -rp "Stop EkBill here and back up now? [y/N] " yes
[ "${yes:-}" = "y" ] || { echo "Nothing changed."; exit 1; }

for svc in caddy app; do
  c="$(container_of "$svc")"
  [ -z "$c" ] || { docker stop "$c" >/dev/null && echo "stopped $svc"; }
done

"$REPO_DIR/deploy/vm/backup.sh"

echo
echo "Next, on the new VM:  deploy/vm/restore.sh latest --replace && EKBILL_NO_BUILD=1 deploy/vm/up.sh"
echo "Changed your mind?    EKBILL_NO_BUILD=1 deploy/vm/up.sh   (here, brings this copy back)"
