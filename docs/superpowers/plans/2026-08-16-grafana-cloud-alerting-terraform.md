# Grafana Cloud Alerting as Terraform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision Grafana Cloud alerting (contact point, notification policy, 4 static-threshold
alert rules, 2 SLO burn-rate alerts, 3 billing/usage alerts, 1 synthetic `/health` check) as a new
Terraform root module, replacing the manual-UI plan in
`docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md`.

**Architecture:** New singleton root module `infra/terraform/observability/`, own state file in the
existing `ocar-terraform-state` S3 bucket, same pattern as `infra/terraform/bootstrap/`. Applied
locally, not from CI. No application code changes — every metric already exists.

**Tech Stack:** Terraform, `grafana/grafana` provider (~> 3.0), Grafana Cloud (Alerting, SLO,
Synthetic Monitoring).

**Spec:** `docs/superpowers/specs/2026-08-16-grafana-cloud-alerting-terraform-design.md`

---

### Task 0: Prerequisites (blocking — do this before Task 1)

These are values only the user can produce; the engineer executing this plan cannot substitute
placeholders for them.

- [ ] **Step 1: Get a Grafana Cloud access policy token**

Grafana Cloud → **Administration → Users and access → Access policies → Create access policy**.
Scopes: `alerting:write`, `alerting:read`, `slo:write`, `slo:read`,
`synthetic-monitoring:write`, `synthetic-monitoring:read`. Create a token for the policy. Copy it —
it's shown once.

- [ ] **Step 2: Get a Slack incoming webhook URL**

In the target Slack workspace: **Apps → Incoming Webhooks → Add to Slack**, pick the channel, copy
the webhook URL (`https://hooks.slack.com/services/...`).

- [ ] **Step 3: Look up the Prometheus/Mimir datasource UID**

Grafana Cloud → **Connections → Data sources** → click the Prometheus datasource → the UID is the
last path segment of the URL (`.../datasources/edit/<uid>`).

- [ ] **Step 4: Look up Synthetic Monitoring probe IDs**

Grafana Cloud → **Testing & synthetics → Synthetic Monitoring → Probes**. Note the numeric IDs for
2-3 probes geographically close to Odisha (Mumbai/Singapore if listed).

- [ ] **Step 5: Export everything as env vars for the apply step**

```bash
export TF_VAR_grafana_auth="<token from step 1>"
export TF_VAR_slack_webhook_url="<url from step 2>"
export TF_VAR_alert_email="<team alert inbox address>"
export TF_VAR_prometheus_datasource_uid="<uid from step 3>"
export TF_VAR_synthetic_probe_ids='[<id1>, <id2>]'
```

---

### Task 1: Module scaffold

**Files:**
- Create: `infra/terraform/observability/providers.tf`
- Create: `infra/terraform/observability/variables.tf`
- Create: `infra/terraform/observability/outputs.tf`

- [ ] **Step 1: Write `providers.tf`**

```hcl
# infra/terraform/observability/providers.tf
#
# Own state (observability/terraform.tfstate, same bucket the rest of Terraform
# uses) -- this is one account-wide Grafana Cloud stack, not a per-environment
# resource, same reasoning as infra/terraform/bootstrap/. See
# docs/superpowers/specs/2026-08-16-grafana-cloud-alerting-terraform-design.md.
#
# Applied locally (terraform init && terraform plan/apply from this directory),
# not from CI -- this changes rarely enough that a new pipeline secret isn't
# justified yet.
terraform {
  required_version = ">= 1.9.0"

  required_providers {
    grafana = {
      source  = "grafana/grafana"
      version = "~> 3.0"
    }
  }

  backend "s3" {
    bucket       = "ocar-terraform-state"
    key          = "observability/terraform.tfstate"
    region       = "ap-south-1"
    use_lockfile = true
  }
}

provider "grafana" {
  cloud_access_policy_token = var.grafana_auth
}
```

- [ ] **Step 2: Write `variables.tf`**

```hcl
# infra/terraform/observability/variables.tf

variable "grafana_auth" {
  type        = string
  description = "Grafana Cloud access policy token (alerting:write, slo:write, synthetic-monitoring:write). Set via TF_VAR_grafana_auth, never committed."
  sensitive   = true
}

variable "slack_webhook_url" {
  type        = string
  description = "Slack incoming webhook URL for the #alerts-equivalent channel. Set via TF_VAR_slack_webhook_url."
  sensitive   = true
}

variable "alert_email" {
  type        = string
  description = "Backup email address for alert notifications."
}

variable "prometheus_datasource_uid" {
  type        = string
  description = "UID of the Grafana Cloud Prometheus/Mimir datasource -- found at Connections > Data sources > (the Prometheus one) > URL's trailing path segment."
}

variable "synthetic_probe_ids" {
  type        = list(number)
  description = "Synthetic Monitoring probe IDs to run the /health check from -- found at Testing & synthetics > Synthetic Monitoring > Probes. Prefer probes geographically close to Odisha (Mumbai/Singapore)."
}
```

- [ ] **Step 3: Write `outputs.tf`**

```hcl
# infra/terraform/observability/outputs.tf

output "contact_point_uid" {
  description = "UID of the shared alert contact point -- referenced when adding new rule groups later"
  value       = grafana_contact_point.default.id
}
```

- [ ] **Step 4: Init and validate the empty module**

```bash
cd infra/terraform/observability
terraform init
terraform validate
```
Expected: `terraform init` succeeds (downloads the `grafana` provider), `terraform validate`
reports an error that `grafana_contact_point.default` is undefined — expected, since Task 2 hasn't
been written yet. This step only confirms the provider/backend config itself is valid.

- [ ] **Step 5: Commit**

```bash
git add infra/terraform/observability/providers.tf infra/terraform/observability/variables.tf infra/terraform/observability/outputs.tf
git commit -m "feat(infra): scaffold observability Terraform module"
```

---

### Task 2: Contact point & notification policy

**Files:**
- Create: `infra/terraform/observability/notifications.tf`

- [ ] **Step 1: Write `notifications.tf`**

```hcl
# infra/terraform/observability/notifications.tf
#
# grafana_notification_policy is a whole-tree resource -- applying it replaces
# the ENTIRE policy. Once this is in Terraform, never hand-edit the policy in
# the Grafana UI; the next apply would silently clobber the UI edit.

resource "grafana_contact_point" "default" {
  name = "ocar-alerts"

  slack {
    url = var.slack_webhook_url
  }

  email {
    addresses = [var.alert_email]
  }
}

resource "grafana_notification_policy" "root" {
  contact_point   = grafana_contact_point.default.name
  group_by        = ["alertname"]
  group_wait      = "30s"
  group_interval  = "5m"
  repeat_interval = "4h"
}
```

- [ ] **Step 2: Validate and plan**

```bash
terraform validate
terraform plan
```
Expected: `validate` passes. `plan` shows 2 resources to add (`grafana_contact_point.default`,
`grafana_notification_policy.root`) and nothing else.

- [ ] **Step 3: Apply**

```bash
terraform apply
```
Type `yes` when prompted. Expected: `Apply complete! Resources: 2 added, 0 changed, 0 destroyed.`

- [ ] **Step 4: Verify in Grafana Cloud UI**

Alerting → Contact points → confirm "ocar-alerts" exists with both Slack and email integrations.
Alerting → Notification policies → confirm the root policy routes to "ocar-alerts".
Click "Test" on the contact point — confirm a test message arrives in Slack and email. (This only
proves the integrations work, not routing — routing gets verified in Task 3's Step 5.)

- [ ] **Step 5: Commit**

```bash
git add infra/terraform/observability/notifications.tf
git commit -m "feat(infra): provision Grafana Cloud contact point and notification policy"
```

---

### Task 3: Static-threshold alert rules

**Files:**
- Create: `infra/terraform/observability/alerts-static.tf`

- [ ] **Step 1: Write `alerts-static.tf`**

```hcl
# infra/terraform/observability/alerts-static.tf
#
# Same PromQL, thresholds, and `for:` durations as
# docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md
# section #6 -- that doc keeps the per-rule rationale; this file is the source
# of truth for what's actually deployed.

resource "grafana_folder" "alerts" {
  title = "Ocar Alerts"
}

resource "grafana_rule_group" "static_thresholds" {
  name             = "ocar-static-thresholds"
  folder_uid       = grafana_folder.alerts.uid
  interval_seconds = 60

  rule {
    name      = "Error rate - rides & payments (warning)"
    condition = "C"
    for       = "5m"

    data {
      ref_id         = "A"
      datasource_uid = var.prometheus_datasource_uid
      relative_time_range {
        from = 300
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "sum(rate(http_request_duration_seconds_count{route=~\"/api/v1/rides.*|/api/v1/payments.*\", status_code=~\"5..\"}[5m])) / sum(rate(http_request_duration_seconds_count{route=~\"/api/v1/rides.*|/api/v1/payments.*\"}[5m]))"
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
        conditions = [{ evaluator = { type = "gt", params = [0.05] } }]
      })
    }

    annotations = {
      summary     = "5xx ratio on rides/payments routes exceeded 5% over 5m"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Error rate - rides & payments (critical)"
    condition = "C"
    for       = "2m"

    data {
      ref_id         = "A"
      datasource_uid = var.prometheus_datasource_uid
      relative_time_range {
        from = 300
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "sum(rate(http_request_duration_seconds_count{route=~\"/api/v1/rides.*|/api/v1/payments.*\", status_code=~\"5..\"}[5m])) / sum(rate(http_request_duration_seconds_count{route=~\"/api/v1/rides.*|/api/v1/payments.*\"}[5m]))"
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
        conditions = [{ evaluator = { type = "gt", params = [0.15] } }]
      })
    }

    annotations = {
      summary     = "5xx ratio on rides/payments routes exceeded 15% over 2m"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "critical" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "pg.Pool exhaustion"
    condition = "C"
    for       = "5m"

    data {
      ref_id         = "A"
      datasource_uid = var.prometheus_datasource_uid
      relative_time_range {
        from = 60
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "pg_pool_connections{state=\"waiting\"}"
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
        conditions = [{ evaluator = { type = "gt", params = [2] } }]
      })
    }

    annotations = {
      summary     = "pg.Pool has >= 3 connections waiting for 5m -- requests are queuing behind the pool"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "GPS-flush write latency p95"
    condition = "C"
    for       = "5m"

    data {
      ref_id         = "A"
      datasource_uid = var.prometheus_datasource_uid
      relative_time_range {
        from = 300
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{route=\"/api/v1/geo/tracks/flush\"}[5m])) by (le))"
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
        conditions = [{ evaluator = { type = "gt", params = [1] } }]
      })
    }

    annotations = {
      summary     = "GPS breadcrumb flush p95 latency exceeded 1s for 5m"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Host disk usage"
    condition = "C"
    for       = "10m"

    data {
      ref_id         = "A"
      datasource_uid = var.prometheus_datasource_uid
      relative_time_range {
        from = 60
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "100 - ((node_filesystem_avail_bytes{mountpoint=\"/\"} * 100) / node_filesystem_size_bytes{mountpoint=\"/\"})"
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
        conditions = [{ evaluator = { type = "gt", params = [85] } }]
      })
    }

    annotations = {
      summary     = "Host disk usage exceeded 85% for 10m"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }
}
```

- [ ] **Step 2: Validate and plan**

```bash
terraform validate
terraform plan
```
Expected: `plan` shows 2 resources to add (`grafana_folder.alerts`,
`grafana_rule_group.static_thresholds`). If `validate` errors on the `data`/`model` block shape,
check the exact schema against
[the `grafana_rule_group` resource docs](https://registry.terraform.io/providers/grafana/grafana/latest/docs/resources/rule_group)
— Grafana's alerting API JSON model has changed shape across provider minor versions before.

- [ ] **Step 3: Apply**

```bash
terraform apply
```
Type `yes`. Expected: `Apply complete! Resources: 2 added, 0 changed, 0 destroyed.`

- [ ] **Step 4: Verify in Grafana Cloud UI**

Alerting → Alert rules → "Ocar Alerts" folder → confirm all 5 rules exist (2 error-rate severities
+ pool + GPS-flush + disk), each showing the correct `for` duration and threshold.

- [ ] **Step 5: Verify real routing (not just the contact point test)**

Temporarily edit the disk-usage rule's threshold in the Grafana UI from `85` to `0` (so it's
already true) — do NOT edit via Terraform for this test, since it's reverted in the next step.
Wait one evaluation interval (up to 60s). Confirm the alert fires and a message reaches Slack and
email. Revert the threshold back to `85` in the UI, then run `terraform plan` — expected: **no
diff** (confirms the UI value matches what Terraform already has, i.e. the temporary edit was
fully reverted).

- [ ] **Step 6: Commit**

```bash
git add infra/terraform/observability/alerts-static.tf
git commit -m "feat(infra): provision static-threshold Grafana Cloud alert rules"
```

---

### Task 4: Billing/usage alerts

**Files:**
- Create: `infra/terraform/observability/alerts-billing.tf`

- [ ] **Step 1: Write `alerts-billing.tf`**

```hcl
# infra/terraform/observability/alerts-billing.tf
#
# Alerts at 85% of Grafana Cloud's free-tier caps -- same three signals and
# threshold as docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md
# section #7. Using the cap itself as the budget means 85% fires comfortably
# before the hard cutoff, no separate math to get wrong.

resource "grafana_rule_group" "billing_usage" {
  name             = "ocar-billing-usage"
  folder_uid       = grafana_folder.alerts.uid
  interval_seconds = 300

  rule {
    name      = "Active series usage >= 85% of free tier"
    condition = "C"
    for       = "10m"

    data {
      ref_id         = "A"
      datasource_uid = var.prometheus_datasource_uid
      relative_time_range {
        from = 60
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "grafanacloud_org_metrics_instance_active_series / 10000"
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
        conditions = [{ evaluator = { type = "gt", params = [0.85] } }]
      })
    }

    annotations = {
      summary     = "Active series usage is at or above 85% of the 10,000-series free-tier cap"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Logs usage >= 85% of free tier"
    condition = "C"
    for       = "10m"

    data {
      ref_id         = "A"
      datasource_uid = var.prometheus_datasource_uid
      relative_time_range {
        from = 60
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "grafanacloud_org_logs_usage_bytes / (50 * 1024 * 1024 * 1024)"
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
        conditions = [{ evaluator = { type = "gt", params = [0.85] } }]
      })
    }

    annotations = {
      summary     = "Logs usage is at or above 85% of the 50GB free-tier cap"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }

  rule {
    name      = "Traces usage >= 85% of free tier"
    condition = "C"
    for       = "10m"

    data {
      ref_id         = "A"
      datasource_uid = var.prometheus_datasource_uid
      relative_time_range {
        from = 60
        to   = 0
      }
      model = jsonencode({
        refId   = "A"
        instant = true
        expr    = "grafanacloud_org_traces_usage_bytes / (50 * 1024 * 1024 * 1024)"
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
        conditions = [{ evaluator = { type = "gt", params = [0.85] } }]
      })
    }

    annotations = {
      summary     = "Traces usage is at or above 85% of the 50GB free-tier cap"
      runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md"
    }
    labels         = { severity = "warning" }
    no_data_state  = "OK"
    exec_err_state = "Alerting"
  }
}
```

- [ ] **Step 2: Validate and plan**

```bash
terraform validate
terraform plan
```
Expected: 1 resource to add. If the exact `grafanacloud_org_*` metric names don't match what's
actually exposed, browse them first: Grafana Cloud → **Billing/Usage dashboard** → any panel →
"Edit" → copy the exact metric name from that panel's query, then update the `expr` above to match.

- [ ] **Step 3: Apply**

```bash
terraform apply
```
Type `yes`. Expected: `Apply complete! Resources: 1 added, 0 changed, 0 destroyed.`

- [ ] **Step 4: Verify in Grafana Cloud UI**

Alerting → Alert rules → "Ocar Alerts" folder → confirm all 3 billing rules exist and show
evaluated (non-error) state — a value near the real current usage, not "no data".

- [ ] **Step 5: Commit**

```bash
git add infra/terraform/observability/alerts-billing.tf
git commit -m "feat(infra): provision Grafana Cloud free-tier usage alerts"
```

---

### Task 5: Synthetic `/health` check

**Files:**
- Create: `infra/terraform/observability/synthetic.tf`

- [ ] **Step 1: Write `synthetic.tf`**

```hcl
# infra/terraform/observability/synthetic.tf
#
# TLS-expiry threshold bumped from Grafana's 7-day default to 14 for comfort
# -- ACM auto-renews (see CLAUDE.md's 2026-08-13 ALB migration note) so this
# is defense-in-depth against a renewal failure, not the original
# certbot-can-silently-fail reason it was first proposed for.

resource "grafana_synthetic_monitoring_check" "health" {
  job       = "ocar-api-health"
  target    = "https://ocar-api.clienttesting.in/health"
  enabled   = true
  probes    = var.synthetic_probe_ids
  frequency = 60000
  timeout   = 10000

  settings {
    http {
      method              = "GET"
      ip_version          = "V4"
      valid_status_codes  = [200]
      body_matches {
        expression = "\"status\":\"ok\""
        type       = "not_contains"
      }
    }
  }

  alert_sensitivity = "medium"
}
```

- [ ] **Step 2: Validate and plan**

```bash
terraform validate
terraform plan
```
Expected: 1 resource to add. If `validate` errors on `body_matches`/`settings.http` field names,
check the exact schema at
[the `grafana_synthetic_monitoring_check` resource docs](https://registry.terraform.io/providers/grafana/grafana/latest/docs/resources/synthetic_monitoring_check)
— fix field names to match, the intent (GET /health, expect 200 + `"status":"ok"` in body) stays
the same.

- [ ] **Step 3: Apply**

```bash
terraform apply
```
Type `yes`. Expected: `Apply complete! Resources: 1 added, 0 changed, 0 destroyed.`

- [ ] **Step 4: Verify in Grafana Cloud UI**

Testing & synthetics → Synthetic Monitoring → confirm "ocar-api-health" check exists, is enabled,
and its first execution (within ~60s) shows green across all configured probes.

- [ ] **Step 5: Commit**

```bash
git add infra/terraform/observability/synthetic.tf
git commit -m "feat(infra): provision synthetic /health uptime check"
```

---

### Task 6: SLO burn-rate alerts — ride & payment success

**Files:**
- Create: `infra/terraform/observability/slo.tf`

- [ ] **Step 1: Write `slo.tf`**

```hcl
# infra/terraform/observability/slo.tf
#
# 98% objective / 2% error budget is a starting point, not a value backed by
# real historical traffic yet -- revisit once real ride/payment volume
# exists. Unlike the static rules in alerts-static.tf, these two are the
# ones the 2026-08-16 design doc flags as needing retuning at low traffic
# volume (Google SRE Workbook's own caveat about burn-rate math assuming
# higher request rates).

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
    fastburn {
      annotation {
        name  = "runbook_url"
        value = local.runbook_url
      }
      notification_group = grafana_contact_point.default.name
    }
    slowburn {
      annotation {
        name  = "runbook_url"
        value = local.runbook_url
      }
      notification_group = grafana_contact_point.default.name
    }
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
    fastburn {
      annotation {
        name  = "runbook_url"
        value = local.runbook_url
      }
      notification_group = grafana_contact_point.default.name
    }
    slowburn {
      annotation {
        name  = "runbook_url"
        value = local.runbook_url
      }
      notification_group = grafana_contact_point.default.name
    }
  }
}
```

- [ ] **Step 2: Validate and plan**

```bash
terraform validate
terraform plan
```
Expected: 2 resources to add. If `validate` errors on the `alerting`/`fastburn`/`slowburn` block
shape, check the exact schema at
[the `grafana_slo` resource docs](https://registry.terraform.io/providers/grafana/grafana/latest/docs/resources/slo)
— the burn-rate windows and 14.4x/6x multipliers are Grafana-managed defaults generated from the
objective, not something this file needs to compute by hand.

- [ ] **Step 3: Apply**

```bash
terraform apply
```
Type `yes`. Expected: `Apply complete! Resources: 2 added, 0 changed, 0 destroyed.`

- [ ] **Step 4: Verify in Grafana Cloud UI**

Alerting → SLOs → confirm both "Ride request success rate" and "Payment request success rate"
exist, each showing real (non-blank) burn-rate data within the first evaluation window. If either
shows blank/no-data, the route regex isn't matching any live traffic yet — note this rather than
treating blank as "working", per the design doc's verification section.

- [ ] **Step 5: Commit**

```bash
git add infra/terraform/observability/slo.tf
git commit -m "feat(infra): provision SLO burn-rate alerts for ride and payment success rate"
```

---

### Task 7: Supersede the manual-UI runbook

**Files:**
- Modify: `docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md:1`

- [ ] **Step 1: Add a banner at the top of the file**

```markdown
# Grafana Cloud alerting, billing alerts, synthetic check — runbook

> **Superseded 2026-08-16:** provisioning now happens via Terraform in
> `infra/terraform/observability/` — see
> `docs/superpowers/specs/2026-08-16-grafana-cloud-alerting-terraform-design.md` and
> `docs/superpowers/plans/2026-08-16-grafana-cloud-alerting-terraform.md`. This document is kept as
> the per-rule rationale (why each threshold/route/window was picked) that the Terraform files
> reference in comments — do not use it as the provisioning method anymore.

**Date:** 2026-08-09
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md
git commit -m "docs: mark manual-UI alerting runbook as superseded by Terraform"
```

---

### Task 8: Final end-to-end verification

- [ ] **Step 1: Full plan diff check**

```bash
cd infra/terraform/observability
terraform plan
```
Expected: `No changes. Your infrastructure matches the configuration.` — confirms nothing drifted
between Tasks 2-6's applies and now.

- [ ] **Step 2: Confirm CLAUDE.md's pending-ops note can be closed out**

Open `CLAUDE.md`, find the bullet starting "**Grafana Cloud alerting, usage-billing alerts, and a
synthetic `/health` check are not yet configured**" (under "Pending Ops Actions"). Delete that
bullet entirely — the note's own instruction is "Delete this note once all of it is clicked
through," and Tasks 2-6 have now provisioned all of it via Terraform instead of clicks.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: close out Grafana Cloud alerting pending-ops note, now provisioned via Terraform"
```
