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
#   2. There is no per-check field to configure a numeric TLS-expiry
#      alert threshold (e.g. "14 days"). TLS certificate expiry is one of
#      the built-in per-check alert types Grafana Synthetic Monitoring
#      generates once `alert_sensitivity` is set to anything but `none`,
#      but the actual day-threshold for that built-in alert is only
#      adjustable from the Grafana Cloud UI (Synthetic Monitoring -> this
#      check -> Alerting), not via this Terraform resource. So the 14-day
#      bump referenced above is a manual one-time UI click, not code --
#      tracked so it isn't lost: after first apply, open this check in the
#      UI and set the TLS-expiry per-check alert threshold to 14 days.

resource "grafana_synthetic_monitoring_check" "health" {
  job       = "ocar-api-health"
  target    = "https://ocar-api.clienttesting.in/health"
  enabled   = true
  probes    = var.synthetic_probe_ids # Mumbai/Singapore -- closest to the Odisha user base
  frequency = 60000
  timeout   = 10000

  # Enables Grafana's built-in per-check alerts (probe failures, TLS
  # expiry, etc.) at medium sensitivity, routed through the same
  # notification policy/contact point as everything else in this module.
  alert_sensitivity = "medium"

  settings {
    http {
      method              = "GET"
      ip_version          = "V4"
      valid_status_codes  = [200]

      # Check FAILS if the body does NOT contain this string -- i.e. this
      # asserts the body DOES contain "status":"ok". (There is no
      # "assert contains" field; `fail_if_body_not_matches_regexp` is the
      # only way to express a positive body assertion.)
      fail_if_body_not_matches_regexp = ["\"status\":\"ok\""]
    }
  }
}
