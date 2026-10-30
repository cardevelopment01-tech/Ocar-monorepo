# infra/terraform/observability/alerts-alloy.tf
#
# Watches the telemetry pipeline itself. Every other alert in this stack reads
# data that Alloy ships -- if Alloy dies they all go quiet (and most use
# no_data_state = "OK"), so these are the only rules that notice. Metric names
# verified against a live grafana/alloy:v1.18.1 container.
#
# Absence is detected with absent_over_time(): it returns a series ONLY when the
# data is missing, so "empty result" is the healthy state (no_data_state = OK)
# and there's no ambiguity with a real no-data condition.

locals {
  alloy_rules = {
    "Alloy heartbeat lost (no metrics arriving)" = {
      expr      = "absent_over_time(alloy_config_last_load_successful{__ENV__}[10m])"
      threshold = 0
      for       = "5m"
      severity  = "critical"
      summary   = "No Alloy self-metrics for 10m -- every host's Alloy is down or can't reach Grafana Cloud. All other alerts are blind."
    }
    "Alloy config failed to load" = {
      expr      = "min(alloy_config_last_load_successful{__ENV__})"
      threshold = 0.5 # gauge is 1 (ok) / 0 (failed); fires when < 0.5
      invert    = true
      for       = "5m"
      severity  = "critical"
      summary   = "An Alloy instance's last config load failed (bad SSM alloy-config?) -- it is running the previous config or nothing."
    }
    "Alloy unhealthy components" = {
      expr      = "sum(alloy_component_controller_running_components{__ENV__, health_type=\"unhealthy\"})"
      threshold = 0
      for       = "10m"
      severity  = "warning"
      summary   = "One or more Alloy components report unhealthy for 10m (check `docker logs ocar_alloy`)."
    }
    "Alloy S3 log archive failing" = {
      expr      = "sum(increase(otelcol_exporter_send_failed_log_records_total{__ENV__}[15m]))"
      threshold = 0
      for       = "10m"
      severity  = "critical"
      summary   = "Alloy is failing to write logs to the S3 archive (IAM/KMS/bucket?). Loki still receives logs; the 6-month archive has a gap."
    }
    "Alloy remote_write to Grafana failing" = {
      expr      = "sum(increase(prometheus_remote_storage_samples_failed_total{__ENV__}[10m]))"
      threshold = 0
      for       = "10m"
      severity  = "warning"
      summary   = "Metric samples are being rejected/failed on remote_write (series cap hit? bad credentials?)."
    }
  }
}

resource "grafana_rule_group" "alloy_pipeline_stg" {
  name             = "ocar-alloy-pipeline-stg"
  folder_uid       = grafana_folder.alerts.uid
  interval_seconds = 60

  dynamic "rule" {
    for_each = local.alloy_rules
    content {
      name      = "${rule.key} [stg]"
      condition = "C"
      for       = rule.value.for

      data {
        ref_id         = "A"
        datasource_uid = local.prometheus_datasource_uid
        relative_time_range {
          from = 900
          to   = 0
        }
        model = jsonencode({
          refId   = "A"
          instant = true
          expr    = replace(rule.value.expr, "__ENV__", local.alert_env.stg)
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
          conditions = [{ evaluator = { type = try(rule.value.invert, false) ? "lt" : "gt", params = [rule.value.threshold] } }]
        })
      }

      annotations = {
        summary     = rule.value.summary
        runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/OPS_RUNBOOK.md"
      }
      labels         = { severity = rule.value.severity, env = "stg" }
      no_data_state  = "OK"
      exec_err_state = "Alerting"
    }
  }
}
