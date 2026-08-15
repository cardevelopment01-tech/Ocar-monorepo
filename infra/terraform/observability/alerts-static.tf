# infra/terraform/observability/alerts-static.tf
#
# Same PromQL, thresholds, and `for:` durations as
# docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md
# section #6 -- that doc keeps the per-rule rationale; this file is the source
# of truth for what's actually deployed.

resource "grafana_folder" "alerts" {
  title = "Ocar Alerts"
}

resource "grafana_rule_group" "static_thresholds" {
  name             = "ocar-static-thresholds"
  folder_uid       = grafana_folder.alerts.uid
  interval_seconds = 60

  rule {
    name      = "Error rate - rides & payments (warning)"
    condition = "C"
    for       = "5m"

    data {
      ref_id         = "A"
      datasource_uid = var.prometheus_datasource_uid
      relative_time_range {
        from = 300
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "sum(rate(http_request_duration_seconds_count{route=~\"/api/v1/rides.*|/api/v1/payments.*\", status_code=~\"5..\"}[5m])) / sum(rate(http_request_duration_seconds_count{route=~\"/api/v1/rides.*|/api/v1/payments.*\"}[5m]))"
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
        conditions = [{ evaluator = { type = "gt", params = [0.05] } }]
      })
    }

    annotations = {
      summary     = "5xx ratio on rides/payments routes exceeded 5% over 5m"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Error rate - rides & payments (critical)"
    condition = "C"
    for       = "2m"

    data {
      ref_id         = "A"
      datasource_uid = var.prometheus_datasource_uid
      relative_time_range {
        from = 300
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "sum(rate(http_request_duration_seconds_count{route=~\"/api/v1/rides.*|/api/v1/payments.*\", status_code=~\"5..\"}[5m])) / sum(rate(http_request_duration_seconds_count{route=~\"/api/v1/rides.*|/api/v1/payments.*\"}[5m]))"
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
        conditions = [{ evaluator = { type = "gt", params = [0.15] } }]
      })
    }

    annotations = {
      summary     = "5xx ratio on rides/payments routes exceeded 15% over 2m"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "critical" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "pg.Pool exhaustion"
    condition = "C"
    for       = "5m"

    data {
      ref_id         = "A"
      datasource_uid = var.prometheus_datasource_uid
      relative_time_range {
        from = 60
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "pg_pool_connections{state=\"waiting\"}"
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
        conditions = [{ evaluator = { type = "gt", params = [2] } }]
      })
    }

    annotations = {
      summary     = "pg.Pool has >= 3 connections waiting for 5m -- requests are queuing behind the pool"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "GPS-flush write latency p95"
    condition = "C"
    for       = "5m"

    data {
      ref_id         = "A"
      datasource_uid = var.prometheus_datasource_uid
      relative_time_range {
        from = 300
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{route=\"/api/v1/geo/tracks/flush\"}[5m])) by (le))"
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
        conditions = [{ evaluator = { type = "gt", params = [1] } }]
      })
    }

    annotations = {
      summary     = "GPS breadcrumb flush p95 latency exceeded 1s for 5m"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Host disk usage"
    condition = "C"
    for       = "10m"

    data {
      ref_id         = "A"
      datasource_uid = var.prometheus_datasource_uid
      relative_time_range {
        from = 60
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "100 - ((node_filesystem_avail_bytes{mountpoint=\"/\"} * 100) / node_filesystem_size_bytes{mountpoint=\"/\"})"
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
        conditions = [{ evaluator = { type = "gt", params = [85] } }]
      })
    }

    annotations = {
      summary     = "Host disk usage exceeded 85% for 10m"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }
}
