# infra/terraform/observability/alerts-static.tf
#
# Same PromQL, thresholds, and `for:` durations as
# docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md
# section #6 -- that doc keeps the per-rule rationale; this file is the source
# of truth for what's actually deployed.

locals {
  rides_payments_error_rate_expr = "sum(rate(http_request_duration_seconds_count{route=~\"/api/v1/rides.*|/api/v1/payments.*\", status_code=~\"5..\"}[5m])) / sum(rate(http_request_duration_seconds_count{route=~\"/api/v1/rides.*|/api/v1/payments.*\"}[5m]))"
}

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
      datasource_uid = local.prometheus_datasource_uid
      relative_time_range {
        from = 300
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = local.rides_payments_error_rate_expr
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
      datasource_uid = local.prometheus_datasource_uid
      relative_time_range {
        from = 300
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = local.rides_payments_error_rate_expr
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
      datasource_uid = local.prometheus_datasource_uid
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
      datasource_uid = local.prometheus_datasource_uid
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
      datasource_uid = local.prometheus_datasource_uid
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

  # These 6 rules cover the node_exporter families added to config.alloy's
  # keep-list on 2026-08-30 specifically for incident/audit value -- without
  # an alert, that data only helps someone actively watching a dashboard
  # during a test, not passive daily monitoring. runbook_url points at
  # OPS_RUNBOOK.md's troubleshooting section (not the general alerting design
  # doc) since that's where the actual response steps for these live.
  rule {
    name      = "Host swap in use"
    condition = "C"
    for       = "10m"

    data {
      ref_id         = "A"
      datasource_uid = local.prometheus_datasource_uid
      relative_time_range {
        from = 60
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "node_memory_SwapTotal_bytes - node_memory_SwapFree_bytes"
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
        # 50MB -- any real swap usage on a t3.medium api host is already a
        # bad sign, not a threshold that needs tuning up from real traffic.
        conditions = [{ evaluator = { type = "gt", params = [52428800] } }]
      })
    }

    annotations = {
      summary     = "Host has used >50MB of swap for 10m -- memory pressure"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/OPS_RUNBOOK.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Disk I/O saturation"
    condition = "C"
    for       = "10m"

    data {
      ref_id         = "A"
      datasource_uid = local.prometheus_datasource_uid
      relative_time_range {
        from = 300
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "rate(node_disk_io_time_seconds_total[5m])"
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
        # A device spending >=90% of the last 5m actually busy servicing
        # I/O -- the standard USE "saturation" reading for disks.
        conditions = [{ evaluator = { type = "gt", params = [0.9] } }]
      })
    }

    annotations = {
      summary     = "A disk device was >=90% busy servicing I/O for 10m"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/OPS_RUNBOOK.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Network errors or drops"
    condition = "C"
    for       = "5m"

    data {
      ref_id         = "A"
      datasource_uid = local.prometheus_datasource_uid
      relative_time_range {
        from = 300
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "rate(node_network_receive_errs_total[5m]) + rate(node_network_transmit_errs_total[5m]) + rate(node_network_receive_drop_total[5m]) + rate(node_network_transmit_drop_total[5m])"
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
        conditions = [{ evaluator = { type = "gt", params = [0] } }]
      })
    }

    annotations = {
      summary     = "Real network interface errors or drops sustained for 5m (ephemeral Docker interfaces are already excluded at the source)"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/OPS_RUNBOOK.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Host inode usage"
    condition = "C"
    for       = "10m"

    data {
      ref_id         = "A"
      datasource_uid = local.prometheus_datasource_uid
      relative_time_range {
        from = 60
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "100 - ((node_filesystem_files_free{mountpoint=\"/\"} * 100) / node_filesystem_files{mountpoint=\"/\"})"
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
        # Same 85% convention as "Host disk usage" -- inode exhaustion can
        # happen with plenty of free bytes still showing, a classic gap this
        # rule specifically closes.
        conditions = [{ evaluator = { type = "gt", params = [85] } }]
      })
    }

    annotations = {
      summary     = "Host inode usage exceeded 85% for 10m -- disk can still show free space while writes fail"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/OPS_RUNBOOK.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Filesystem remounted read-only"
    condition = "C"
    for       = "1m"

    data {
      ref_id         = "A"
      datasource_uid = local.prometheus_datasource_uid
      relative_time_range {
        from = 60
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "node_filesystem_readonly{mountpoint=\"/\"} and (time() - node_boot_time_seconds) > 300"
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
        conditions = [{ evaluator = { type = "gt", params = [0] } }]
      })
    }

    annotations = {
      summary     = "Root filesystem was remounted read-only -- almost always follows an unrecovered disk error, not a config change"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/OPS_RUNBOOK.md"
    }
    labels         = { severity = "critical" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "File descriptor exhaustion"
    condition = "C"
    for       = "5m"

    data {
      ref_id         = "A"
      datasource_uid = local.prometheus_datasource_uid
      relative_time_range {
        from = 60
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "node_filefd_allocated / node_filefd_maximum"
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
      summary     = "Host file descriptor usage exceeded 85% for 5m -- classic Node.js failure mode under connection/file-handle leaks"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/OPS_RUNBOOK.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  # Added after docs/INCIDENT_2026-08-25_PROD_DB_AUTH_OUTAGE.md -- a full DB
  # auth outage (28P01) was only caught by a human reading logs, not this
  # rule group. api/src/observability/metrics.ts's pg_query_errors_total
  # counter (added in the same change as this rule) is what makes this
  # queryable at all -- 1m/>0 because a real auth break means every single
  # query fails immediately and repeatedly, not an occasional blip.
  rule {
    name      = "Postgres auth errors (28P01/28000)"
    condition = "C"
    for       = "1m"

    data {
      ref_id         = "A"
      datasource_uid = local.prometheus_datasource_uid
      relative_time_range {
        from = 60
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "sum(increase(pg_query_errors_total{code=~\"28P01|28000\"}[1m]))"
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
        conditions = [{ evaluator = { type = "gt", params = [0] } }]
      })
    }

    annotations = {
      summary     = "Postgres rejected a query with an auth error (28P01 invalid_password or 28000 invalid_authorization_specification) -- check DB_AUTH_MODE and the credential source before assuming it's transient"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/INCIDENT_2026-08-25_PROD_DB_AUTH_OUTAGE.md"
    }
    labels         = { severity = "critical" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  # scheduler is a real BullMQ queue name (api/src/jobs/queues/index.ts) --
  # this reuses the existing bullmq_queue_job_counts gauge, no app change
  # needed. gt 2 / for 10m mirrors this file's own tolerance elsewhere
  # (disk usage) for a background job class where an isolated retry isn't
  # actionable but a sustained pile-up is.
  rule {
    name      = "BullMQ scheduler job failures"
    condition = "C"
    for       = "10m"

    data {
      ref_id         = "A"
      datasource_uid = local.prometheus_datasource_uid
      relative_time_range {
        from = 60
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "bullmq_queue_job_counts{queue=\"scheduler\", state=\"failed\"}"
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
      summary     = "The BullMQ scheduler queue has more than 2 failed jobs sustained for 10m"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }
}
