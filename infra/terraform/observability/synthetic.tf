# infra/terraform/observability/synthetic.tf
#
# TLS-expiry threshold bumped from Grafana's 7-day default to 14 for comfort
# -- ACM auto-renews (see CLAUDE.md's 2026-08-13 ALB migration note) so this
# is defense-in-depth against a renewal failure, not the original
# certbot-can-silently-fail reason it was first proposed for.
#
# NOTE: verified against the grafana/grafana v3.25.9 provider schema
# (`terraform providers schema -json`) -- the plan's original snippet had
# two problems this file corrects:
#   1. There is no `body_matches` block on `grafana_synthetic_monitoring_check`.
#      The real field is `fail_if_body_not_matches_regexp` (a set of regexes;
#      the check FAILS when the body does NOT match). To assert "body
#      contains \"status\":\"ok\"", that string must be a
#      fail_if_body_not_matches_regexp entry -- using the plan's proposed
#      `type = "not_contains"` on a nonexistent field would have silently
#      shipped no assertion at all, or (if the field existed as literally
#      named) the inverse of the intended check.
#   2. The per-check alert thresholds (e.g. TLS-expiry days) live on a
#      separate resource, `grafana_synthetic_monitoring_check_alerts`,
#      keyed by `check_id`. Its `alerts` field is a *set attribute* of
#      objects (name/period/threshold), assigned with `= [...]`, not a
#      repeatable `alerts { ... }` block -- the pinned v3.25.9 schema has
#      no `runbook_url` field on that object (a newer provider version's
#      docs mention one; this pin doesn't have it, so it's omitted below).
#      The `grafana_synthetic_monitoring_check_alerts.health` resource
#      below sets the TLS-expiry threshold to 14 days directly in code --
#      no manual UI step needed.

resource "grafana_synthetic_monitoring_check" "health" {
  job       = "ocar-api-health"
  target    = "https://ocar-api.clienttesting.in/health"
  enabled   = true
  probes    = var.synthetic_probe_ids # Mumbai/Singapore -- closest to the Odisha user base
  frequency = 60000
  timeout   = 10000

  # "none", not "medium" -- discovered at first real `apply`: this account
  # has legacy per-check alerting disabled ("legacy alerts usage is
  # forbidden", a 403 on check creation when alert_sensitivity != "none").
  # Alerting is handled entirely by the separate
  # grafana_synthetic_monitoring_check_alerts resource below instead.
  alert_sensitivity = "none"

  settings {
    http {
      method             = "GET"
      ip_version         = "V4"
      valid_status_codes = [200]

      # Check FAILS if the body does NOT contain this string -- i.e. this
      # asserts the body DOES contain "status":"ok". (There is no
      # "assert contains" field; `fail_if_body_not_matches_regexp` is the
      # only way to express a positive body assertion.)
      fail_if_body_not_matches_regexp = ["\"status\":\"ok\""]
    }
  }
}

# Per-check alert thresholds -- verified against the grafana/grafana v3.25.9
# provider schema (`terraform providers schema -json`): `alerts` is a set
# attribute of {name, period, threshold} objects, not a repeatable block.
#
# Verified 2026-08-16 on first real apply: `period = ""` and
# `name = "TLSTargetCertificateCloseToExpiring"` are accepted as-is by the
# live API -- resource applied cleanly, no adjustment needed.
resource "grafana_synthetic_monitoring_check_alerts" "health" {
  check_id = grafana_synthetic_monitoring_check.health.id
  alerts = [
    {
      name      = "TLSTargetCertificateCloseToExpiring"
      threshold = 14
      period    = ""
    }
  ]
}
