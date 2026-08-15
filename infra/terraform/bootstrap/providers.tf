# infra/terraform/bootstrap/providers.tf
#
# Deliberately its own separate state (bootstrap/terraform.tfstate, in the
# same bucket the main prod/staging config uses) -- these are account-wide
# singleton resources (the state bucket itself, the GitHub OIDC provider),
# applied once, almost never touched again. Keeping them in the same shared
# root module the per-environment configs use is exactly what caused every
# staging apply to try (and fail) to re-create resources prod's state
# already owns. See docs/superpowers/plans/2026-08-15-terraform-bootstrap-singleton-split.md.
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

  backend "s3" {
    bucket       = "ocar-terraform-state"
    key          = "bootstrap/terraform.tfstate"
    region       = "ap-south-1"
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "ocar"
      ManagedBy = "terraform"
      Scope     = "bootstrap"
    }
  }
}
