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
  # Every resource in this module (folders, contact points, alert rule
  # groups, SLOs) hits the classic in-stack Grafana REST API, which wants a
  # genuine Service Account token minted from inside that Grafana instance
  # (Administration > Users and access > Service accounts), NOT a Cloud
  # Access Policy token -- discovered at first real `apply`: both
  # `cloud_access_policy_token` and an access-policy token passed as `auth`
  # were rejected (401 Invalid API key / client-not-initialized) despite
  # correct realm/scopes.
  url  = var.grafana_url
  auth = var.grafana_auth

  # Synthetic Monitoring authenticates via a separate token+URL pair from
  # the main Service Account token above -- generated from within the app
  # itself (Testing & synthetics -> Synthetics -> Config tab -> "Generate
  # access token"), not via cloud_access_policy_token. Verified against the
  # grafana/grafana v3.25.9 provider schema (`terraform providers schema
  # -json`): sm_access_token/sm_url are plain top-level optional arguments
  # on this same provider block -- no aliased provider block required.
  sm_access_token = var.sm_access_token
  sm_url          = var.sm_url
}
