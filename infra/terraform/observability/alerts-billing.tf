# infra/terraform/observability/alerts-billing.tf
#
# Alerts at 85% of Grafana Cloud's free-tier caps -- same three signals and
# threshold as docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md
# section #7. Using the cap itself as the budget means 85% fires comfortably
# before the hard cutoff, no separate math to get wrong.

locals {
  free_tier_bytes_50gb = 50 * 1024 * 1024 * 1024
  # Confirmed against the account's real configured limit, seen directly in
  # a live 429 (err-mimir-max-active-series) during the 2026-08-30 incident
  # ("...tenant exceeded the active series limit, set to 15000...") -- the
  # 10,000 figure this alert previously divided by didn't match reality.
  free_tier_active_series = 15000
}

resource "grafana_rule_group" "billing_usage" {
  name             = "ocar-billing-usage"
  folder_uid       = grafana_folder.alerts.uid
  interval_seconds = 300

  rule {
    name      = "Active series usage >= 85% of free tier"
    condition = "C"
    for       = "10m"

    data {
      ref_id         = "A"
      datasource_uid = local.usage_insights_datasource_uid
      relative_time_range {
        from = 60
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "grafanacloud_instance_active_series / ${local.free_tier_active_series}"
      })
    }

    data {
      ref_id         = "C"
      datasource_uid = "__expr__"
      relative_time_range {
        from = 0
        to   = 0
      }
      model = jsonencode({
        refId      = "C"
        type       = "threshold"
        expression = "A"
        conditions = [{ evaluator = { type = "gt", params = [0.85] } }]
      })
    }

    annotations = {
      summary     = "Active series usage is at or above 85% of the ${local.free_tier_active_series}-series free-tier cap"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Logs usage >= 85% of free tier"
    condition = "C"
    for       = "10m"

    data {
      ref_id         = "A"
      datasource_uid = local.usage_insights_datasource_uid
      relative_time_range {
        from = 60
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "grafanacloud_logs_instance_usage / (${local.free_tier_bytes_50gb})"
      })
    }

    data {
      ref_id         = "C"
      datasource_uid = "__expr__"
      relative_time_range {
        from = 0
        to   = 0
      }
      model = jsonencode({
        refId      = "C"
        type       = "threshold"
        expression = "A"
        conditions = [{ evaluator = { type = "gt", params = [0.85] } }]
      })
    }

    annotations = {
      summary     = "Logs usage is at or above 85% of the 50GB free-tier cap"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Traces usage >= 85% of free tier"
    condition = "C"
    for       = "10m"

    data {
      ref_id         = "A"
      datasource_uid = local.usage_insights_datasource_uid
      relative_time_range {
        from = 60
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "grafanacloud_traces_instance_usage / (${local.free_tier_bytes_50gb})"
      })
    }

    data {
      ref_id         = "C"
      datasource_uid = "__expr__"
      relative_time_range {
        from = 0
        to   = 0
      }
      model = jsonencode({
        refId      = "C"
        type       = "threshold"
        expression = "A"
        conditions = [{ evaluator = { type = "gt", params = [0.85] } }]
      })
    }

    annotations = {
      summary     = "Traces usage is at or above 85% of the 50GB free-tier cap"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }
}
