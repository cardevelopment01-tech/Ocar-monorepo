# infra/terraform/observability/alerts-alloy-prd.tf
#
# Mirror of the prod alert group for the prd environment (env="prd" series only), with the same thresholds, durations
# and contact point. Rule names carry a " [prd]" suffix so Grafana does not group them with prod's alerts of the same name.
# Prod's own group (the matching file without -prd) selects env!="prd", which also matches prod's series before they gain the
# env label. Keep the two files in step when a rule changes.

resource "grafana_rule_group" "alloy_pipeline_prd" {
  name             = "ocar-alloy-pipeline-prd"
  folder_uid       = grafana_folder.alerts.uid
  interval_seconds = 60

  dynamic "rule" {
    for_each = local.alloy_rules
    content {
      name      = "${rule.key} [prd]"
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
          expr    = replace(rule.value.expr, "__ENV__", local.alert_env.prd)
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
      labels         = { severity = rule.value.severity, env = "prd" }
      no_data_state  = "OK"
      exec_err_state = "Alerting"
    }
  }
}
