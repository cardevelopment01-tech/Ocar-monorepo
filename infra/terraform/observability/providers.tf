# infra/terraform/observability/providers.tf
#
# Own state (observability/terraform.tfstate, same bucket the rest of Terraform
# uses) -- this is one account-wide Grafana Cloud stack, not a per-environment
# resource, same reasoning as infra/terraform/bootstrap/. See
# docs/superpowers/specs/2026-08-16-grafana-cloud-alerting-terraform-design.md.
#
# Applied locally (terraform init && terraform plan/apply from this directory),
# not from CI -- this changes rarely enough that a new pipeline secret isn't
# justified yet.
terraform {
  required_version = ">= 1.9.0"

  required_providers {
    grafana = {
      source  = "grafana/grafana"
      version = "~> 3.0"
    }
  }

  backend "s3" {
    bucket       = "ocar-terraform-state"
    key          = "observability/terraform.tfstate"
    region       = "ap-south-1"
    use_lockfile = true
  }
}

provider "grafana" {
  cloud_access_policy_token = var.grafana_auth
}
