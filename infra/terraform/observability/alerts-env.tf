# infra/terraform/observability/alerts-env.tf
#
# Label matcher that scopes an alert to one environment. Alloy tags every series and log line with env (metrics gained the
# label on 2026-10-29), so prod and prd, which share one Grafana stack, would otherwise be counted together. Prod's
# series have no env label until prod's Alloy config is next applied, hence "not prd" for prod instead of env="prod".
locals {
  alert_env = {
    prod = "env!=\"prd\""
    prd  = "env=\"prd\""
  }
}
