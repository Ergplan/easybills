# EkBill on the tariff-order VM, project "tariff-order-parsing".  Nothing here is a secret.
#   cd infra/gcp && terraform init -backend-config=envs/dev.backend.hcl
#   terraform apply -var-file=envs/dev.tfvars
project_id         = "tariff-order-parsing"
region             = "asia-south1"
vm_name            = "tariff-order"
vm_zone            = "asia-south2-b"
vm_service_account = "agent-builder@tariff-order-parsing.iam.gserviceaccount.com"

# Filled in by deploy/vm/setup.sh from the metadata server (-var vm_external_ip=...).
vm_external_ip = ""
