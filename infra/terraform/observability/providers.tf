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
#
# Every credential/config value this module needs lives in SSM under
# /ocar/observability/* (see the data sources below), not in a local .tfvars
# file or TF_VAR_* env vars -- a laptop-only tfvars file got lost once
# already (2026-08-19), which is exactly the single point of failure SSM
# (same account-wide store already used for docker-compose.prod.yml/
# config.alloy in ../ssm-observability.tf and for ghcr-token/
# migration-database-url in ../iam.tf) avoids. To update a value, see
# "Updating an observability secret" in docs/OPS_RUNBOOK.md.
terraform {
  required_version = ">= 1.9.0"

  required_providers {
    grafana = {
      source  = "grafana/grafana"
      version = "~> 3.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket       = "ocar-terraform-state"
    key          = "observability/terraform.tfstate"
    region       = "ap-south-1"
    use_lockfile = true
  }
}

provider "aws" {
  region = "ap-south-1"
}

data "aws_ssm_parameter" "grafana_auth" {
  name            = "/ocar/observability/grafana-auth"
  with_decryption = true
}

data "aws_ssm_parameter" "grafana_url" {
  name = "/ocar/observability/grafana-url"
}

data "aws_ssm_parameter" "slack_webhook_url" {
  name            = "/ocar/observability/slack-webhook-url"
  with_decryption = true
}

data "aws_ssm_parameter" "alert_email" {
  name = "/ocar/observability/alert-email"
}

data "aws_ssm_parameter" "prometheus_datasource_uid" {
  name = "/ocar/observability/prometheus-datasource-uid"
}

data "aws_ssm_parameter" "synthetic_probe_ids" {
  name = "/ocar/observability/synthetic-probe-ids"
}

data "aws_ssm_parameter" "sm_access_token" {
  name            = "/ocar/observability/sm-access-token"
  with_decryption = true
}

data "aws_ssm_parameter" "sm_url" {
  name = "/ocar/observability/sm-url"
}

data "aws_ssm_parameter" "usage_insights_datasource_uid" {
  name = "/ocar/observability/usage-insights-datasource-uid"
}

locals {
  grafana_auth                  = data.aws_ssm_parameter.grafana_auth.value
  grafana_url                   = data.aws_ssm_parameter.grafana_url.value
  slack_webhook_url             = data.aws_ssm_parameter.slack_webhook_url.value
  alert_email                   = data.aws_ssm_parameter.alert_email.value
  prometheus_datasource_uid     = data.aws_ssm_parameter.prometheus_datasource_uid.value
  synthetic_probe_ids           = [for id in split(",", data.aws_ssm_parameter.synthetic_probe_ids.value) : tonumber(id)]
  sm_access_token               = data.aws_ssm_parameter.sm_access_token.value
  sm_url                        = data.aws_ssm_parameter.sm_url.value
  usage_insights_datasource_uid = data.aws_ssm_parameter.usage_insights_datasource_uid.value
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
  url  = local.grafana_url
  auth = local.grafana_auth

  # Synthetic Monitoring authenticates via a separate token+URL pair from
  # the main Service Account token above -- generated from within the app
  # itself (Testing & synthetics -> Synthetics -> Config tab -> "Generate
  # access token"), not via cloud_access_policy_token. Verified against the
  # grafana/grafana v3.25.9 provider schema (`terraform providers schema
  # -json`): sm_access_token/sm_url are plain top-level optional arguments
  # on this same provider block -- no aliased provider block required.
  sm_access_token = local.sm_access_token
  sm_url          = local.sm_url
}
