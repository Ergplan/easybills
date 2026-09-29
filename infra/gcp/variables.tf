variable "project_id" {
  description = "The Google Cloud project the VM lives in."
  type        = string
}

variable "region" {
  description = "Region for EkBill's regional resources (secrets, backup bucket)."
  type        = string
  default     = "asia-south1"
}

variable "vm_name" {
  description = "The existing VM EkBill runs on. Not managed here."
  type        = string
  default     = "tariff-order"
}

variable "vm_zone" {
  type    = string
  default = "asia-south2-b"
}

variable "vm_service_account" {
  description = "The VM's service account, given read access to EkBill's secrets and its backup bucket."
  type        = string
}

variable "vm_external_ip" {
  description = <<-EOT
    The VM's current external IP. When set, it is reserved as a static address (the ephemeral IP
    is promoted in place, nothing restarts), so the HTTPS name keeps pointing at the VM. Empty
    leaves the address as it is.
  EOT
  type        = string
  default     = ""
}

variable "backup_retention_days" {
  description = "How long nightly database dumps are kept."
  type        = number
  default     = 30
}
