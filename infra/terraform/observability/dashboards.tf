# infra/terraform/observability/dashboards.tf
#
# Terraform-managed since 2026-09-08 -- was manual re-import into Grafana
# Cloud before this (see infra/grafana/dashboards/README.md's git history).
# Reverses the "no provisioning automation" call in
# docs/superpowers/plans/2026-08-09-grafana-log-level-filter-design.md, made
# when this dashboard changed rarely; it now needs to survive staging
# destroy/rebuild cycles without a manual re-import step being forgotten.
#
# The Grafana API (which this provider talks to) takes a raw dashboard JSON
# model -- it does not resolve the ${DS_PROMETHEUS}/${DS_LOKI} __inputs
# prompts the manual "Dashboards -> Import" UI flow shows. Substitute the
# real datasource UIDs before pushing.
resource "grafana_dashboard" "ocar_overview" {
  config_json = replace(
    replace(
      file("${path.module}/../../grafana/dashboards/ocar-overview.json"),
      "$${DS_PROMETHEUS}", local.prometheus_datasource_uid
    ),
    "$${DS_LOKI}", local.loki_datasource_uid
  )

  # The dashboard already exists live (uid ocar-overview) -- must be
  # `terraform import`-ed into this resource address before the first
  # apply, not created fresh. overwrite lets subsequent applies update it
  # in place by uid, matching the fixed-uid behavior the dashboard's own
  # description already documents.
  overwrite = true
}
