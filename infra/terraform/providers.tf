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
  backend "s3" {
    bucket       = "ocar-terraform-state"
    key          = "prod/terraform.tfstate"
    region       = "ap-south-1"
    use_lockfile = true
  }
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
