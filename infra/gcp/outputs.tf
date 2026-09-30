output "backup_bucket" {
  value = google_storage_bucket.backups.name
}

output "secrets" {
  value = concat(keys(local.generated_secrets), local.operator_secrets)
}

output "external_ip" {
  value = var.vm_external_ip
}

output "default_domain" {
  description = "A name that resolves to the VM with no DNS setup, until a real one (e.g. ekbill.aayuda.energy) points at external_ip."
  value       = var.vm_external_ip == "" ? "" : "${replace(var.vm_external_ip, ".", "-")}.sslip.io"
}

output "own_vm" {
  description = "EkBill's own VM, when own_vm = true."
  value = var.own_vm ? {
    name   = google_compute_instance.own_vm[0].name
    zone   = google_compute_instance.own_vm[0].zone
    ip     = google_compute_address.own_vm[0].address
    domain = "${replace(google_compute_address.own_vm[0].address, ".", "-")}.sslip.io"
    ssh    = "gcloud compute ssh ${google_compute_instance.own_vm[0].name} --zone ${google_compute_instance.own_vm[0].zone} --project ${var.project_id}"
  } : null
}
