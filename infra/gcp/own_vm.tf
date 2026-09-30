# EkBill's own VM, "ekbill", so it stops sharing disk, IP and network settings with the tariff
# product.  Off until own_vm = true (deploy/vm/own-vm.sh create sets it).  See docs/own-vm.md.
#
# Its own service account reads only EkBill's secrets and writes only EkBill's backup bucket; its
# address is reserved from the start, so the HTTPS name never changes under it.

resource "google_service_account" "own_vm" {
  count        = var.own_vm ? 1 : 0
  account_id   = "ekbill-vm"
  display_name = "EkBill VM"
  description  = "Runs EkBill on the ekbill VM: reads ekbill-* secrets, writes EkBill backups."
}

locals {
  own_vm_sa = var.own_vm ? "serviceAccount:${google_service_account.own_vm[0].email}" : ""
}

resource "google_compute_address" "own_vm" {
  count        = var.own_vm ? 1 : 0
  name         = "ekbill-vm-ip"
  region       = local.vm_region
  address_type = "EXTERNAL"
  labels       = local.labels
}

resource "google_compute_instance" "own_vm" {
  count        = var.own_vm ? 1 : 0
  name         = "ekbill"
  zone         = var.vm_zone
  machine_type = var.own_vm_machine_type
  tags         = ["ekbill-web"]
  labels       = local.labels

  # A plain `terraform destroy` or a typo cannot take the bills with it.
  deletion_protection       = true
  allow_stopping_for_update = true

  boot_disk {
    auto_delete = false
    initialize_params {
      image  = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
      size   = var.own_vm_disk_gb
      type   = "pd-balanced"
      labels = local.labels
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.own_vm[0].address
    }
  }

  service_account {
    email  = google_service_account.own_vm[0].email
    scopes = ["cloud-platform"]
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  # Docker, git and cron, installed on first boot; the operator clones the repo and runs
  # deploy/vm/host-setup.sh.
  metadata_startup_script = file("${path.module}/own_vm_startup.sh")
}

# The new VM's access: the same secrets and bucket the old VM had, through its own identity.
resource "google_secret_manager_secret_iam_member" "own_vm_reads_generated" {
  for_each  = { for k, v in google_secret_manager_secret.generated : k => v if var.own_vm }
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.own_vm_sa
}

resource "google_secret_manager_secret_iam_member" "own_vm_reads_operator" {
  for_each  = { for k, v in google_secret_manager_secret.operator : k => v if var.own_vm }
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.own_vm_sa
}

resource "google_storage_bucket_iam_member" "own_vm_writes_backups" {
  count  = var.own_vm ? 1 : 0
  bucket = google_storage_bucket.backups.name
  role   = "roles/storage.objectAdmin"
  member = local.own_vm_sa
}

# Logs and metrics in Cloud Logging/Monitoring, as any VM's agent sends them.
resource "google_project_iam_member" "own_vm_logs" {
  for_each = var.own_vm ? toset(["roles/logging.logWriter", "roles/monitoring.metricWriter"]) : toset([])
  project  = var.project_id
  role     = each.value
  member   = local.own_vm_sa
}
