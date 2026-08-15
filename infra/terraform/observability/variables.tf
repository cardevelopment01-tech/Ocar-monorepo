# infra/terraform/observability/variables.tf

variable "grafana_auth" {
  type        = string
  description = "Grafana Cloud access policy token (alerting:write, slo:write, synthetic-monitoring:write). Set via TF_VAR_grafana_auth, never committed."
  sensitive   = true
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
