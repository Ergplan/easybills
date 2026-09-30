#!/usr/bin/env bash
# One-time setup on EkBill's OWN VM (the "ekbill" VM that Terraform creates; see docs/own-vm.md).
# Safe to run again. No Terraform here: the VM, its address, firewall and access were made by
# deploy/vm/own-vm.sh. This checks the machine, schedules the backup and starts EkBill.
#
#   cd ~/easybills && deploy/vm/host-setup.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

say "Where we are"
name="$(instance_name)"
echo "vm: ${name:-unknown}   project: $PROJECT"
[ "$name" != "tariff-order" ] || { echo "This is the tariff-order VM. host-setup.sh is for EkBill's own VM; use setup.sh here."; exit 1; }
df -h / | tail -1
docker ps >/dev/null 2>&1 || {
  echo "Docker is not usable by $USER yet. Run:  sudo usermod -aG docker \$USER  then log out and in again."
  echo "(If docker is missing altogether, the startup script is still installing it: wait a minute.)"
  exit 1
}
for port in 80 443 5441 8080; do
  if ss -ltn "( sport = :$port )" | grep -q LISTEN; then
    owner="$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E "(:|\s)$port->" | awk '{print $1}' || true)"
    case "$owner" in ekbill-*) ;; *) echo "Port $port is already in use (${owner:-not by docker}). Stop and ask."; exit 1 ;; esac
  fi
done
free_gb="$(df -BG --output=avail / | tail -1 | tr -dc 0-9)"
[ "$free_gb" -ge 12 ] || [ "${EKBILL_NO_BUILD:-}" = "1" ] || { echo "Only ${free_gb}G free; a build needs about 10G."; exit 1; }

say "Access to EkBill's secrets"
[ -n "$(secret ekbill-db-password)" ] || { echo "This VM cannot read ekbill-db-password. Was deploy/vm/own-vm.sh applied?"; exit 1; }
echo "database password: readable; OpenAI key: $([ -n "$(secret ekbill-openai-api-key)" ] && echo present || echo 'not set (add with deploy/vm/set-openai-key.sh)')"

say "Nightly backup at 02:30 IST (21:00 UTC)"
line="0 21 * * * $REPO_DIR/deploy/vm/backup.sh >> \$HOME/ekbill-backup.log 2>&1"
if command -v crontab >/dev/null 2>&1; then
  ( crontab -l 2>/dev/null | grep -v 'deploy/vm/backup.sh' ; echo "$line" ) | crontab -
  crontab -l | grep backup.sh
else
  echo "cron is not installed yet (the startup script adds it). Run this script again in a minute."
fi

"$REPO_DIR/deploy/vm/up.sh"

echo
echo "Moving from the tariff-order VM? Next: deploy/vm/handover.sh there, then deploy/vm/restore.sh latest --replace here."
