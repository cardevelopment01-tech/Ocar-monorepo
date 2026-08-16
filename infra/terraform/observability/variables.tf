# infra/terraform/observability/variables.tf

variable "grafana_auth" {
  type        = string
  description = "Grafana stack Service Account token (Administration > Users and access > Service accounts), NOT a Cloud Access Policy token -- the classic in-stack REST API (folders, contact points, SLOs) rejects Access Policy tokens even with correct realm/scopes. Set via TF_VAR_grafana_auth, never committed."
  sensitive   = true
}

variable "grafana_url" {
  type        = string
  description = "URL of the Grafana Cloud stack every resource in this module targets, e.g. https://<stack-name>.grafana.net. Required alongside grafana_auth -- an access-policy token alone doesn't tell the provider which stack's HTTP API to call."
}

variable "slack_webhook_url" {
  type        = string
  description = "Slack incoming webhook URL for the #alerts-equivalent channel. Set via TF_VAR_slack_webhook_url."
  sensitive   = true
}

variable "alert_email" {
  type        = string
  description = "Backup email address for alert notifications."
}

variable "prometheus_datasource_uid" {
  type        = string
  description = "UID of the Grafana Cloud Prometheus/Mimir datasource -- found at Connections > Data sources > (the Prometheus one) > URL's trailing path segment."
}

variable "synthetic_probe_ids" {
  type        = list(number)
  description = "Synthetic Monitoring probe IDs to run the /health check from -- found at Testing & synthetics > Synthetic Monitoring > Probes. Prefer probes geographically close to Odisha (Mumbai/Singapore)."
}

variable "sm_access_token" {
  type        = string
  description = "Grafana Cloud Synthetic Monitoring access token -- separate from grafana_auth, generated at Testing & synthetics > Synthetics > Config > Generate access token. Set via TF_VAR_sm_access_token, never committed."
  sensitive   = true
}

variable "sm_url" {
  type        = string
  description = "Grafana Cloud Synthetic Monitoring API server URL (e.g. https://synthetic-monitoring-api-<region>.grafana.net), shown on the same Config page as the access token."
}

variable "usage_insights_datasource_uid" {
  type        = string
  description = "UID of the Grafana Cloud usage-insights datasource (exposes grafanacloud_org_* billing/usage metrics) -- distinct from the app's own Prometheus/Mimir datasource. Found at Connections > Data sources > the datasource typically named \"grafanacloud-usage\" or similar > URL's trailing path segment. Confirm the exact name/UID in the Grafana Cloud console, since it isn't guessable in advance."
}
