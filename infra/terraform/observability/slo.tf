# infra/terraform/observability/slo.tf
#
# 98% objective / 2% error budget is a starting point, not a value backed by
# real historical traffic yet -- revisit once real ride/payment volume
# exists. Unlike the static rules in alerts-static.tf, these two are the
# ones the 2026-08-16 design doc flags as needing retuning at low traffic
# volume (Google SRE Workbook's own caveat about burn-rate math assuming
# higher request rates).
#
# Schema note: the grafana_slo resource has no `notification_group` /
# contact-point attribute anywhere (verified against `terraform providers
# schema -json` for grafana/grafana ~> 3.0) -- burn-rate alerts it generates
# route through the existing catch-all grafana_notification_policy.root
# (notifications.tf), same as every other alert rule in this module. Its
# `alerting.annotation` block also takes `key`/`value`, not `name`/`value`.

locals {
  runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/specs/2026-08-16-grafana-cloud-alerting-terraform-design.md"
}

resource "grafana_slo" "ride_success" {
  name        = "Ride request success rate"
  description = "Non-5xx ratio on /api/v1/rides.* -- same signal as the static error-rate alert, reused as an SLO input."

  query {
    type = "freeform"
    freeform {
      query = "sum(rate(http_request_duration_seconds_count{route=~\"/api/v1/rides.*\", status_code!~\"5..\"}[$__rate_interval])) / sum(rate(http_request_duration_seconds_count{route=~\"/api/v1/rides.*\"}[$__rate_interval]))"
    }
  }

  objectives {
    value  = 0.98
    window = "30d"
  }

  destination_datasource {
    uid = var.prometheus_datasource_uid
  }

  label {
    key   = "service"
    value = "ocar-api"
  }

  alerting {
    annotation {
      key   = "runbook_url"
      value = local.runbook_url
    }

    fastburn {}
    slowburn {}
  }
}

resource "grafana_slo" "payment_success" {
  name        = "Payment request success rate"
  description = "Non-5xx ratio on /api/v1/payments.* -- same signal as the static error-rate alert, reused as an SLO input."

  query {
    type = "freeform"
    freeform {
      query = "sum(rate(http_request_duration_seconds_count{route=~\"/api/v1/payments.*\", status_code!~\"5..\"}[$__rate_interval])) / sum(rate(http_request_duration_seconds_count{route=~\"/api/v1/payments.*\"}[$__rate_interval]))"
    }
  }

  objectives {
    value  = 0.98
    window = "30d"
  }

  destination_datasource {
    uid = var.prometheus_datasource_uid
  }

  label {
    key   = "service"
    value = "ocar-api"
  }

  alerting {
    annotation {
      key   = "runbook_url"
      value = local.runbook_url
    }

    fastburn {}
    slowburn {}
  }
}
