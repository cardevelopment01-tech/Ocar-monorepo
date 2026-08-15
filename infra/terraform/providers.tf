# Terraform itself, and which providers (plugins that know how to talk to a
# given cloud) this config needs. Pinning versions here means "terraform init"
# always downloads the same provider version, so a plan/apply run six months
# from now behaves the same as one run today.
terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # S3 backend, migrated off local state now that CI needs to read the same
  # state this machine does -- native S3 locking (use_lockfile) instead of
  # the older DynamoDB-table pattern, no extra resource needed for it.
  #
  # Deliberately empty: values come ONLY from an explicit
  # `-backend-config=<env>.backend.hcl` at init time (see prod.backend.hcl /
  # staging.backend.hcl). Before the staging environment existed, this block
  # had prod's values hardcoded here directly -- which meant a bare
  # `terraform init` with no flags silently initialized against prod's real
  # state. With two environments now sharing this same config, that silent
  # default is exactly what could make a staging-intended plan/apply target
  # prod's state by accident. No backend may ever be the default again.
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "ocar"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
