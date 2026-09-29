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
