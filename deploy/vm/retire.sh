#!/usr/bin/env bash
# On the OLD tariff-order VM, once EkBill runs on its own VM and you have checked it: take EkBill
# off this VM. Only the ekbill compose project, its images and its cron line are touched -- never
# the tariff or fdre products, their volumes (tariff_pgdata stays), images or build cache.
#
#   deploy/vm/retire.sh                 # stop and remove EkBill's containers; keep its data volume
#   deploy/vm/retire.sh --delete-data   # also delete EkBill's database volume and images here
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ "$(instance_name)" = "tariff-order" ] || { echo "retire.sh is for the old tariff-order VM. This is $(instance_name)."; exit 1; }

say "Before"
df -h / | tail -1
docker ps -a --filter label=com.docker.compose.project=ekbill --format '{{.Names}}  {{.Status}}'

echo
echo "Only do this once EkBill on its own VM is working and has your latest bills."
read -rp "Remove EkBill's containers from this VM? [y/N] " yes
[ "${yes:-}" = "y" ] || { echo "Nothing changed."; exit 1; }

docker ps -aq --filter label=com.docker.compose.project=ekbill | xargs -r docker rm -f >/dev/null
echo "EkBill containers removed."
docker network ls -q --filter label=com.docker.compose.project=ekbill | xargs -r docker network rm >/dev/null || true

if command -v crontab >/dev/null 2>&1; then
  ( crontab -l 2>/dev/null | grep -v 'deploy/vm/backup.sh' ) | crontab - || true
  echo "nightly EkBill backup removed from this VM's cron"
fi

if [ "${1:-}" = "--delete-data" ]; then
  echo
  echo "About to delete EkBill's database volume on this VM. Its backups in gs://$BUCKET stay."
  read -rp "Type 'delete ekbill data' to go ahead: " really
  if [ "$really" = "delete ekbill data" ]; then
    docker volume ls -q --filter label=com.docker.compose.project=ekbill | xargs -r docker volume rm
    # EkBill's own images: the app it built, and Docling and Caddy if nothing else here uses them.
    docker image ls -q --filter label=com.docker.compose.project=ekbill | sort -u | xargs -r docker image rm -f >/dev/null 2>&1 || true
    for image in "${DOCLING_IMAGE:-quay.io/docling-project/docling-serve-cpu:v1.35.0}" caddy:2 pgvector/pgvector:pg16; do
      if [ -z "$(docker ps -aq --filter "ancestor=$image")" ]; then docker image rm "$image" >/dev/null 2>&1 && echo "removed $image"; fi
    done
    echo "EkBill's data and images removed from this VM."
  else
    echo "Kept the data volume."
  fi
fi

say "The ekbill-web network tag"
echo "It opened ports 80 and 443 on this VM for EkBill. Nothing of EkBill listens here any more."
read -rp "Remove the ekbill-web tag from $VM_NAME? [y/N] " untag
if [ "${untag:-}" = "y" ]; then
  gcloud compute instances remove-tags "$VM_NAME" --zone "$VM_ZONE" --tags ekbill-web && echo "tag removed"
fi

say "After"
df -h / | tail -1
echo "Last step, from where you ran own-vm.sh: deploy/vm/own-vm.sh drop-old-access"
