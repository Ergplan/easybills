terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.30"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state in the project's existing state bucket, under EkBill's own prefix:
  #   terraform init -backend-config=envs/dev.backend.hcl
  # Never the tariff product's prefix.
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}
