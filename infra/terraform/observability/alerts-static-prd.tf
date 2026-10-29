# infra/terraform/observability/alerts-static-prd.tf
#
# Mirror of the prod alert group for the prd environment (env="prd" series only), with the same thresholds, durations
# and contact point. Rule names carry a " [prd]" suffix so Grafana does not group them with prod's alerts of the same name.
# Prod's own group (the matching file without -prd) selects env!="prd", which also matches prod's series before they gain the
# env label. Keep the two files in step when a rule changes.

resource "grafana_rule_group" "static_thresholds_prd" {
  name             = "ocar-static-thresholds-prd"
  folder_uid       = grafana_folder.alerts.uid
  interval_seconds = 60

  rule {
    name      = "Error rate - rides & payments (warning) [prd]"
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
        expr    = replace(local.rides_payments_error_rate_expr, "__ENV__", local.alert_env.prd)
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
    labels         = { severity = "warning", env = "prd" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Error rate - rides & payments (critical) [prd]"
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
        expr    = replace(local.rides_payments_error_rate_expr, "__ENV__", local.alert_env.prd)
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
    labels         = { severity = "critical", env = "prd" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "pg.Pool exhaustion [prd]"
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
        expr    = replace("pg_pool_connections{__ENV__, state=\"waiting\"}", "__ENV__", local.alert_env.prd)
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
    labels         = { severity = "warning", env = "prd" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  # Reports daily admin digest (docs/superpowers/specs/2026-09-29-reports-page-redesign-plan.md, CEO D11).
  # Reads the LOG line "admin digest sent" (Loki), not admin_digest_runs_total: that counter lives in one
  # server process, starts at 1 on its first send (which increase() does not count) and disappears on every
  # deploy, so a metric version alerted falsely whenever the fleet had been replaced since 09:00 IST.
  # `or vector(0)` matters: with no matching line at all the query returns nothing, and
  # no_data_state = "OK" would otherwise hide a digest that has never worked.
  rule {
    name      = "Admin daily digest not sent [prd]"
    condition = "C"
    for       = "30m"

    data {
      ref_id         = "A"
      datasource_uid = local.loki_datasource_uid
      query_type     = "instant"
      relative_time_range {
        from = 300
        to   = 0
      }
      # queryType must be set BOTH here and above: Loki reads it from the model (without it the rule
      # returns a time series and errors with "only reduced data can be alerted on", which fires the
      # alert), while the provider reads the data-level field (without it every plan shows a diff).
      model = jsonencode({
        refId     = "A"
        queryType = "instant"
        expr      = replace("sum(count_over_time({container=\"ocar_api\", __ENV__} |= \"admin digest sent\" [26h])) or vector(0)", "__ENV__", local.alert_env.prd)
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
        conditions = [{ evaluator = { type = "lt", params = [1] } }]
      })
    }

    annotations = {
      summary     = "No admin daily digest was sent in the last 26h -- see OPS_RUNBOOK.md 'Admin daily digest did not arrive'"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/OPS_RUNBOOK.md"
    }
    labels         = { severity = "warning", env = "prd" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "GPS-flush write latency p95 [prd]"
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
        expr    = replace("histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{__ENV__, route=\"/api/v1/geo/tracks/flush\"}[5m])) by (le))", "__ENV__", local.alert_env.prd)
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
    labels         = { severity = "warning", env = "prd" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Host disk usage [prd]"
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
        expr    = replace("100 - ((node_filesystem_avail_bytes{__ENV__, mountpoint=\"/\"} * 100) / node_filesystem_size_bytes{__ENV__, mountpoint=\"/\"})", "__ENV__", local.alert_env.prd)
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
    labels         = { severity = "warning", env = "prd" }
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
    name      = "Host swap in use [prd]"
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
        expr    = replace("node_memory_SwapTotal_bytes{__ENV__} - node_memory_SwapFree_bytes{__ENV__}", "__ENV__", local.alert_env.prd)
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
    labels         = { severity = "warning", env = "prd" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Disk I/O saturation [prd]"
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
        expr    = replace("rate(node_disk_io_time_seconds_total{__ENV__}[5m])", "__ENV__", local.alert_env.prd)
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
    labels         = { severity = "warning", env = "prd" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Network errors or drops [prd]"
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
        expr    = replace("rate(node_network_receive_errs_total{__ENV__}[5m]) + rate(node_network_transmit_errs_total{__ENV__}[5m]) + rate(node_network_receive_drop_total{__ENV__}[5m]) + rate(node_network_transmit_drop_total{__ENV__}[5m])", "__ENV__", local.alert_env.prd)
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
    labels         = { severity = "warning", env = "prd" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Host inode usage [prd]"
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
        expr    = replace("100 - ((node_filesystem_files_free{__ENV__, mountpoint=\"/\"} * 100) / node_filesystem_files{__ENV__, mountpoint=\"/\"})", "__ENV__", local.alert_env.prd)
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
    labels         = { severity = "warning", env = "prd" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Filesystem remounted read-only [prd]"
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
        expr    = replace("node_filesystem_readonly{__ENV__, mountpoint=\"/\"} and (time() - node_boot_time_seconds{__ENV__}) > 300", "__ENV__", local.alert_env.prd)
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
    labels         = { severity = "critical", env = "prd" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "File descriptor exhaustion [prd]"
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
        expr    = replace("max(process_open_fds{__ENV__} / process_max_fds{__ENV__})", "__ENV__", local.alert_env.prd)
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
        conditions = [{ evaluator = { type = "gt", params = [0.8] } }]
      })
    }

    annotations = {
      summary     = "API process file descriptor usage exceeded 80% of its limit for 5m -- classic Node.js failure mode under connection/file-handle leaks"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/OPS_RUNBOOK.md"
    }
    labels         = { severity = "warning", env = "prd" }
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
    name      = "Postgres auth errors (28P01/28000) [prd]"
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
        expr    = replace("sum(increase(pg_query_errors_total{__ENV__, code=~\"28P01|28000\"}[1m]))", "__ENV__", local.alert_env.prd)
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
    labels         = { severity = "critical", env = "prd" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  # scheduler is a real BullMQ queue name (api/src/jobs/queues/index.ts) --
  # this reuses the existing bullmq_queue_job_counts gauge, no app change
  # needed. gt 2 / for 10m mirrors this file's own tolerance elsewhere
  # (disk usage) for a background job class where an isolated retry isn't
  # actionable but a sustained pile-up is.
  rule {
    name      = "BullMQ scheduler job failures [prd]"
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
        expr    = replace("bullmq_queue_job_counts{__ENV__, queue=\"scheduler\", state=\"failed\"}", "__ENV__", local.alert_env.prd)
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
    labels         = { severity = "warning", env = "prd" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }
}
