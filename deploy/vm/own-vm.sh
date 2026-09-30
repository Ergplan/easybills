#!/usr/bin/env bash
# EkBill's own VM, through Terraform (infra/gcp, state ekbill/dev). Run where Terraform and your
# gcloud login are: the tariff-order VM, or Cloud Shell (see docs/own-vm.md).
#
#   deploy/vm/own-vm.sh create             # the ekbill VM, its service account, static IP, access
#   deploy/vm/own-vm.sh drop-old-access    # after the move: the tariff-order VM stops reading
#                                          # EkBill's secrets and writing its bucket
#
# Shows the plan and asks before applying. Refuses a plan that deletes anything it should not.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

what="${1:-}"
case "$what" in
  create) old_access=true ;;
  drop-old-access) old_access=false ;;
  *) echo "Usage: deploy/vm/own-vm.sh create | drop-old-access"; exit 1 ;;
esac

say "Terraform (state: gs://tarifforderstudio_tfstate/ekbill/dev)"
cd "$REPO_DIR/infra/gcp" || exit 1
terraform init -input=false -backend-config=envs/dev.backend.hcl >/dev/null
# The address reserved on the tariff-order VM is left exactly as it is: the value it was last
# applied with comes back from the state, so this plan does not touch it.
keep_ip="$(terraform output -raw external_ip 2>/dev/null || true)"
terraform plan -input=false -var-file=envs/dev.tfvars \
  -var "vm_external_ip=$keep_ip" -var own_vm=true -var "old_vm_access=$old_access" -out=ekbill.tfplan

deletes="$(terraform show -json ekbill.tfplan | python3 -c '
import json, sys
plan = json.load(sys.stdin)
print(" ".join(c["address"] for c in plan.get("resource_changes", []) if "delete" in c["change"]["actions"]))
')"
for address in $deletes; do
  case "$what:$address" in
    drop-old-access:google_secret_manager_secret_iam_member.vm_reads_*|drop-old-access:google_storage_bucket_iam_member.vm_writes_backups*)
      echo "Note: removes the tariff-order VM's access: $address" ;;
    *) echo "The plan deletes $address. Not applying; show it to the operator."; rm -f ekbill.tfplan; exit 1 ;;
  esac
done

read -rp "Apply this plan? Only ekbill-* resources should appear above. [y/N] " yes
[ "${yes:-}" = "y" ] || { echo "Not applied."; rm -f ekbill.tfplan; exit 1; }
terraform apply -input=false ekbill.tfplan
rm -f ekbill.tfplan

if [ "$what" = "create" ]; then
  say "EkBill's own VM"
  terraform output own_vm
  echo
  echo "Docker installs itself on first boot (about 2 minutes). Then follow docs/own-vm.md, step 2:"
  echo "  $(terraform output -json own_vm | python3 -c 'import json,sys; print(json.load(sys.stdin)["ssh"])')"
fi
