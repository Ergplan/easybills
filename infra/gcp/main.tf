# EkBill's Google Cloud resources, next to the tariff product in the same project and never
# touching it.  Everything is named ekbill-* and labelled app=ekbill.  The tariff-order VM, its
# disk, service account and the product's resources are not managed here; EkBill's own VM is
# (own_vm.tf).

locals {
  labels    = { app = "ekbill", managed_by = "terraform" }
  vm_sa     = "serviceAccount:${var.vm_service_account}"
  vm_region = join("-", slice(split("-", var.vm_zone), 0, 2)) # asia-south2-b -> asia-south2
}

# ------------------------------------------------------------------ secrets
# Values never pass through a file, a command line or chat.  Terraform generates the two
# passwords; the OpenAI key is added by the operator at a terminal prompt (deploy/vm/setup.sh).

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "random_password" "gate" {
  # Typed by people on phones: long, letters and digits only.
  length  = 16
  special = false
}

locals {
  generated_secrets = {
    "ekbill-db-password"   = random_password.db.result
    "ekbill-gate-password" = random_password.gate.result
  }
  operator_secrets = ["ekbill-openai-api-key"]
}

resource "google_secret_manager_secret" "generated" {
  for_each  = local.generated_secrets
  secret_id = each.key
  labels    = local.labels
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

resource "google_secret_manager_secret_version" "generated" {
  for_each    = local.generated_secrets
  secret      = google_secret_manager_secret.generated[each.key].id
  secret_data = each.value
}

resource "google_secret_manager_secret" "operator" {
  for_each  = toset(local.operator_secrets)
  secret_id = each.value
  labels    = local.labels
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

resource "google_secret_manager_secret_iam_member" "vm_reads_generated" {
  for_each  = { for k, v in google_secret_manager_secret.generated : k => v if var.old_vm_access }
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.vm_sa
}

resource "google_secret_manager_secret_iam_member" "vm_reads_operator" {
  for_each  = { for k, v in google_secret_manager_secret.operator : k => v if var.old_vm_access }
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.vm_sa
}

# ------------------------------------------------------------------ backups
resource "google_storage_bucket" "backups" {
  name                        = "${var.project_id}-ekbill-backups"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  lifecycle_rule {
    condition {
      age = var.backup_retention_days
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_storage_bucket_iam_member" "vm_writes_backups" {
  count  = var.old_vm_access ? 1 : 0
  bucket = google_storage_bucket.backups.name
  role   = "roles/storage.objectAdmin"
  member = local.vm_sa
}

# The grant above gained a count so it can be switched off after the move; same binding, new address.
moved {
  from = google_storage_bucket_iam_member.vm_writes_backups
  to   = google_storage_bucket_iam_member.vm_writes_backups[0]
}

# ------------------------------------------------------------------ the public address
# The VM's IP, reserved so the HTTPS name keeps pointing at it (promotes the ephemeral IP in place).
resource "google_compute_address" "vm" {
  count        = var.vm_external_ip == "" ? 0 : 1
  name         = "ekbill-ip"
  region       = local.vm_region
  address      = var.vm_external_ip
  address_type = "EXTERNAL"
  labels       = local.labels
}

# 80 for the certificate challenge and the redirect, 443 for the app.  Applies only to instances
# carrying the ekbill-web tag, which deploy/vm/setup.sh adds to the VM.
resource "google_compute_firewall" "web" {
  name          = "ekbill-allow-web"
  network       = "default"
  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["ekbill-web"]
  description   = "EkBill: HTTPS (Caddy) on the tariff-order VM"

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
  allow {
    protocol = "udp"
    ports    = ["443"]
  }
}
