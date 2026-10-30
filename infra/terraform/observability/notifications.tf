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

# stg sleeps nights and weekends (.github/workflows/stg-power.yml): 21:00-08:00 IST every day, and all of Saturday and Sunday.
# While it sleeps two stg alerts would fire (Alloy heartbeat lost after 10 minutes, and the admin digest after 26 hours), so
# notifications for env="stg" are muted in those hours. prd is never muted. Keep these hours in step with the workflow.
resource "grafana_mute_timing" "stg_paused" {
  name = "stg-paused"

  intervals {
    location = "Asia/Kolkata"
    times {
      start = "21:00"
      end   = "24:00"
    }
  }

  intervals {
    location = "Asia/Kolkata"
    times {
      start = "00:00"
      end   = "08:00"
    }
  }

  intervals {
    location = "Asia/Kolkata"
    weekdays = ["saturday", "sunday"]
  }
}

resource "grafana_notification_policy" "root" {
  contact_point   = grafana_contact_point.default.name
  group_by        = ["alertname"]
  group_wait      = "30s"
  group_interval  = "5m"
  repeat_interval = "4h"

  # stg alerts carry env="stg" (alerts-*.tf); they inherit the contact point and are muted while stg sleeps.
  policy {
    matcher {
      label = "env"
      match = "="
      value = "stg"
    }
    mute_timings = [grafana_mute_timing.stg_paused.name]
  }
}
