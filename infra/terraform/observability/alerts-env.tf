# infra/terraform/observability/alerts-env.tf
#
# Label matcher that scopes an alert to one environment. Alloy tags every series and log line with env (metrics gained the
# label on 2026-10-29), and prd and stg share one Grafana stack, so each alert group selects its own environment explicitly.
# The old prod stack was destroyed on 2026-10-30; its three alert groups became the stg groups (group names end in -stg and
# every rule name in " [stg]"), the same layout as the prd copies in the matching *-prd.tf files.
locals {
  alert_env = {
    stg = "env=\"stg\""
    prd = "env=\"prd\""
  }
}
