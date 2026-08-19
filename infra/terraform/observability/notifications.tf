# infra/terraform/observability/notifications.tf
#
# grafana_notification_policy is a whole-tree resource -- applying it replaces
# the ENTIRE policy. Once this is in Terraform, never hand-edit the policy in
# the Grafana UI; the next apply would silently clobber the UI edit.

resource "grafana_contact_point" "default" {
  name = "ocar-alerts"

  slack {
    url = local.slack_webhook_url
  }

  email {
    addresses = [local.alert_email]
  }
}

resource "grafana_notification_policy" "root" {
  contact_point   = grafana_contact_point.default.name
  group_by        = ["alertname"]
  group_wait      = "30s"
  group_interval  = "5m"
  repeat_interval = "4h"
}
