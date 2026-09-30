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

variable "own_vm" {
  description = "Create EkBill's own VM (named ekbill), with its own service account and static IP. See docs/own-vm.md."
  type        = bool
  default     = false
}

variable "own_vm_machine_type" {
  description = "4 vCPU / 16 GB: room for Docling's photo reading next to the app, Postgres and PDFs."
  type        = string
  default     = "e2-standard-4"
}

variable "own_vm_disk_gb" {
  type    = number
  default = 50
}

variable "old_vm_access" {
  description = "Whether the tariff-order VM still reads EkBill's secrets and bucket. Set false once EkBill has moved."
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  description = "How long nightly database dumps are kept."
  type        = number
  default     = 30
}
