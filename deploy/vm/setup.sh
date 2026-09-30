#!/usr/bin/env bash
# One-time setup of EkBill on the tariff-order VM. Idempotent: running it again changes nothing
# that is already in place. It never touches the tariff product (its Terraform, secrets, ports,
# compose project or files).
#
#   cd ~/easybills && deploy/vm/setup.sh
#   EKBILL_NO_BUILD=1 deploy/vm/setup.sh   # everything except rebuilding the app image (low disk)
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

say "Where we are"
df -h / | tail -1
docker compose ls || true
gcloud auth list --filter=status:ACTIVE --format='value(account)'
echo "project: $PROJECT   vm: $VM_NAME ($VM_ZONE)"
for port in 80 443 5441 8080; do
  if ss -ltn "( sport = :$port )" | grep -q LISTEN; then
    owner="$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E "(:|\s)$port->" | awk '{print $1}' || true)"
    case "$owner" in ekbill-*) ;; *) echo "Port $port is already in use (${owner:-not by docker}). Stop and ask."; exit 1 ;; esac
  fi
done
free_gb="$(df -BG --output=avail / | tail -1 | tr -dc 0-9)"
if [ "$free_gb" -lt 30 ]; then
  if [ "${EKBILL_NO_BUILD:-}" = "1" ]; then
    # Nothing is built, so nothing much is written: carry on, but say so.
    echo "Only ${free_gb}G free. Carrying on because EKBILL_NO_BUILD=1 (no image is built)."
  else
    echo "Only ${free_gb}G free; EkBill needs ~10G and the product's builds need 20G. Stop and ask."
    echo "To update the address or settings without building: EKBILL_NO_BUILD=1 deploy/vm/setup.sh"
    echo "To free EkBill's own leftovers: deploy/vm/free-space.sh"
    exit 1
  fi
fi

say "Terraform (state: gs://tarifforderstudio_tfstate/ekbill/dev)"
ip="$(external_ip)"
cd "$REPO_DIR/infra/gcp" || exit 1
terraform init -input=false -backend-config=envs/dev.backend.hcl
terraform plan -input=false -var-file=envs/dev.tfvars -var "vm_external_ip=$ip" -out=ekbill.tfplan
# Nothing may be deleted, with one exception: the reserved address follows the VM's IP. When the
# VM's IP has changed (something replaced its network interface), the old reservation is released
# and the new IP reserved -- a delete and a create of ekbill-ip, and nothing else.
deletes="$(terraform show -json ekbill.tfplan | python3 -c '
import json, sys
plan = json.load(sys.stdin)
print(" ".join(c["address"] for c in plan.get("resource_changes", []) if "delete" in c["change"]["actions"]))
')"
for address in $deletes; do
  case "$address" in
    'google_compute_address.vm[0]') echo "Note: the VM's IP changed, so the reserved address moves to $ip (the old one is released)." ;;
    *) echo "The plan deletes $address. Not applying; show it to the operator."; exit 1 ;;
  esac
done
read -rp "Apply this plan? Only ekbill-* resources should appear above. [y/N] " yes
[ "${yes:-}" = "y" ] || { echo "Not applied."; exit 1; }
terraform apply -input=false ekbill.tfplan
rm -f ekbill.tfplan
cd "$REPO_DIR" || exit 1

say "Network tag ekbill-web on the VM (lets the ekbill-allow-web firewall rule apply)"
if gcloud compute instances describe "$VM_NAME" --zone "$VM_ZONE" --format='value(tags.items)' | grep -qw ekbill-web; then
  echo "already tagged"
else
  gcloud compute instances add-tags "$VM_NAME" --zone "$VM_ZONE" --tags ekbill-web
fi

say "OpenAI key (voice, Poocho answers, reading contracts)"
if [ -n "$(secret ekbill-openai-api-key)" ]; then
  echo "already set"
else
  echo "Paste the OpenAI API key and press Enter (nothing is shown; Enter alone skips for now):"
  read -rs key || true
  if [ -n "${key:-}" ]; then
    printf '%s' "$key" | gcloud secrets versions add ekbill-openai-api-key --data-file=- --project="$PROJECT" >/dev/null
    echo "stored in Secret Manager as ekbill-openai-api-key"
  else
    echo "skipped; add later with: deploy/vm/set-openai-key.sh"
  fi
  unset key
fi

say "Nightly backup at 02:30 IST (21:00 UTC)"
line="0 21 * * * $REPO_DIR/deploy/vm/backup.sh >> \$HOME/ekbill-backup.log 2>&1"
if command -v crontab >/dev/null 2>&1; then
  ( crontab -l 2>/dev/null | grep -v 'deploy/vm/backup.sh' ; echo "$line" ) | crontab -
  crontab -l | grep backup.sh
else
  # Not every image ships cron. The app does not need it; only the nightly backup does.
  echo "cron is not installed, so the nightly backup is NOT scheduled yet. To schedule it:"
  echo "  sudo apt-get install -y cron && deploy/vm/setup.sh"
  echo "Until then, back up by hand with deploy/vm/backup.sh."
fi

"$REPO_DIR/deploy/vm/up.sh"
