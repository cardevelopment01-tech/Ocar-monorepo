# Grafana Cloud alerting as Terraform — design

**Date:** 2026-08-16
**Supersedes:** `docs/superpowers/plans/2026-08-09-grafana-alerting-billing-synthetic-runbook.md`'s
provisioning method (manual UI). That doc's threshold values, rationale, and PromQL are still
correct and are reused here as the source of truth for *why* each number was picked — this design
only changes *how* the rules get created and adds two SLO burn-rate alerts.

**Why revisit now:** the 2026-08-09 runbook rejected Terraform/the Alerting API as "unneeded ops
surface for a team with no dedicated ops person." That call was made in isolation from the fact
that this repo already runs `infra/terraform/` routinely (bootstrap module, ASG, IAM, ACM, ALB) —
for a team already doing `terraform apply` regularly, adding a `grafana` provider block and a
handful of resources is reuse of an existing skill and existing CI-adjacent muscle, not a new
surface. Manual-UI alerting also has a concrete failure mode: no review, no diff, and a rule
silently deleted or edited in the UI leaves no trace. Grafana Cloud has no file-based provisioning
(that requires filesystem access this Cloud stack doesn't have), so the choice is UI vs the
official Terraform provider vs the raw HTTP API — the provider wraps the API with proper resources,
so it's strictly better than hand-rolling API calls.

---

## Scope

- New Terraform root module: `infra/terraform/observability/`.
- Provisions: contact point (Slack + email), notification policy, 5 static-threshold alert rules
  (4 signals, with the error-rate signal split into separate warning/critical rules),
  2 SLOs with generated burn-rate alerts (ride success rate, payment success rate), 3 billing/usage
  alerts, 1 synthetic HTTP check on `/health`.
- No application code changes — every metric referenced already exists in
  `api/src/observability/metrics.ts` / `api/src/app.ts`'s route-labeled histogram.
- Out of scope: PagerDuty/Opsgenie-style on-call escalation (no on-call rotation exists), a Slack
  bot/app beyond a single incoming webhook, alerting for staging (staging is spun up/down for load
  tests only — see `docs/superpowers/specs/2026-08-14-staging-runbook.md` — not a standing
  environment worth its own alert rules).

---

## Why its own root module (not folded into the existing prod config)

Same reasoning as `infra/terraform/bootstrap/`: this is an account-wide singleton (one Grafana
Cloud stack), not a per-environment resource. It doesn't scale with `prod`/`staging` the way ASG
instance count does, and folding it into the main config would be the same anti-pattern the
bootstrap-split plan (`2026-08-15-terraform-bootstrap-singleton-split.md`) already fixed once for
AWS resources: a staging apply trying to touch something it doesn't own.

State: own state file, same S3 bucket the rest of Terraform already uses
(`ocar-terraform-state`, key `observability/terraform.tfstate`), following
`infra/terraform/bootstrap/providers.tf`'s exact backend block pattern.

Applied locally (`cd infra/terraform/observability && terraform init && terraform plan/apply`), not
from CI — this changes rarely after initial setup, and wiring a new secret (Grafana service-account
token) into the deploy pipeline for something applied a handful of times a year isn't justified yet.
Revisit only if alert rules start changing frequently enough that manual local apply becomes the
bottleneck.

---

## Provider & auth

```hcl
terraform {
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
  url  = var.grafana_url
  auth = var.grafana_auth
}
```

> **Errata (2026-08-16, after first real apply):** the snippet above originally showed
> `cloud_access_policy_token = var.grafana_auth`. That's wrong — every resource in this module
> (folders, contact points, alerting, SLOs) hits the classic in-stack Grafana REST API, which
> rejects Cloud Access Policy tokens outright (401, even with the correct realm/scopes). It needs a
> genuine **Service Account token** (Administration > Users and access > Service accounts, Admin
> role — Editor lacked `folders:read`), passed as `auth`, plus `url` pointing at the specific stack.
> A separate Cloud Access Policy token is still used, but only for `var.grafana_auth`'s
> Synthetic-Monitoring-adjacent sibling variables, not this main provider block. See
> `infra/terraform/observability/providers.tf`'s own comment for the authoritative version.

`var.grafana_auth` comes from `TF_VAR_grafana_auth` (env var, never committed) — a Grafana stack
Service Account token (see errata above). Same pattern the project already uses for every other
credential (env var / SSM `SecureString`, never hardcoded). `var.slack_webhook_url` follows the
same convention (`TF_VAR_slack_webhook_url`).

**Prerequisite (blocking, needed from the user before `terraform apply`):**
1. A Grafana stack Service Account token (Admin role) — see errata above, not an access policy token.
2. A Slack incoming webhook URL for the channel that should receive alerts.

---

## Contact point & notification policy

One contact point with two integrations — Slack (primary, visible to the whole team) and email
(backup, in case the webhook breaks or gets rotated). One root notification policy routes
everything to it, grouped `by: [alertname]` so a single incident (e.g. DB pool exhaustion) produces
one grouped notification instead of one per firing series.

```hcl
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

`grafana_notification_policy` is a whole-tree resource — applying it replaces the entire policy, so
once this is in Terraform, the policy must never be hand-edited in the Grafana UI (a future
`apply` would silently clobber a UI edit). This constraint is called out in the file header comment.

---

## Static-threshold alert rules

One `grafana_rule_group`, four rules — same PromQL, thresholds, and `for:` durations as
`2026-08-09-grafana-alerting-billing-synthetic-runbook.md` §#6 (not reproduced in full here to
avoid the two docs drifting out of sync; the Terraform file's comments point back to that doc's
per-rule rationale). Each rule gets a `runbook_url` annotation linking to that doc's anchor and a
`for:` duration carried over unchanged:

1. Error-rate spike — rides & payments (warn `>5%`/5m, critical `>15%`/2m)
2. `pg_pool_connections{state="waiting"}` exhaustion (warn `>=3`/5m)
3. GPS-flush write latency p95 (warn `>1s`/5m)
4. Host disk usage (warn `>85%`/10m)

---

## SLO burn-rate alerts — ride & payment success

Two `grafana_slo` resources, using Grafana Cloud's SLO feature to generate the burn-rate alert
rules rather than hand-writing the multi-window PromQL. Each follows the Google SRE Workbook's
canonical two-window pair: **14.4× burn over 1h** (fast-burn, paired with a 5m short window) and
**6× burn over 6h** (slow-burn, paired with a 30m short window) against a 2% error budget.

```hcl
resource "grafana_slo" "ride_success" {
  name        = "Ride request success rate"
  description = "Non-5xx ratio on /api/v1/rides.* — same signal as the static error-rate alert, reused as an SLO input."
  query {
    freeform {
      query = <<-EOT
        sum(rate(http_request_duration_seconds_count{route=~"/api/v1/rides.*", status_code!~"5.."}[$__rate_interval]))
        /
        sum(rate(http_request_duration_seconds_count{route=~"/api/v1/rides.*"}[$__rate_interval]))
      EOT
    }
    type = "freeform"
  }
  objectives {
    value  = 0.98
    window = "30d"
  }
  destination_datasource { uid = var.prometheus_datasource_uid }
  label { key = "service", value = "ocar-api" }

  alerting {
    fastburn { annotation { name = "runbook_url", value = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/specs/2026-08-16-grafana-cloud-alerting-terraform-design.md" } }
    slowburn { annotation { name = "runbook_url", value = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/superpowers/specs/2026-08-16-grafana-cloud-alerting-terraform-design.md" } }
  }
}
```

`grafana_slo.payment_success` mirrors this against `/api/v1/payments.*`. Objective set at 98% (2%
error budget) for both — reasonable starting point, not a value with real historical data behind it
yet; revisit once real ride/payment volume exists to see if 98% is too strict or too loose. This is
the exact same "assumes higher request volume" caveat the research flagged: at low absolute traffic
these two SLOs may need retuning once real numbers come in, unlike the static rules above which
are safe at any volume.

---

## Billing/usage alerts

Three rules against Grafana Cloud's own usage metrics, one per free-tier signal (active series,
logs GB, traces GB), each at 85% of the free-tier cap — same values as the 2026-08-09 runbook §#7,
now as `grafana_rule_group` entries instead of clicking through the Billing/Usage dashboard's
per-panel "New alert rule" UI action.

---

## Synthetic check

```hcl
resource "grafana_synthetic_monitoring_check" "health" {
  job     = "ocar-api-health"
  target  = "https://ocar-api.clienttesting.in/health"
  enabled = true
  probes  = var.synthetic_probe_ids # Mumbai/Singapore — closest to the Odisha user base
  frequency = 60000

  settings {
    http {
      method            = "GET"
      valid_status_codes = [200]
      fail_if_body_not_matches_regexp = ["\"status\":\"ok\""]
      tls_config {
        # built-in expiry check, per Grafana's per-check alert feature
      }
    }
  }
}
```

TLS-expiry alert threshold set to 14 days (Grafana's default is 7 — bumped for comfort, per the
research). Alert fires from ≥2 probes sustained 5m, routed to the same contact point as everything
else above.

---

## What happens to the 2026-08-09 runbook

Gets a one-line banner at the top: "Superseded by Terraform in `infra/terraform/observability/` —
kept for the per-rule rationale the Terraform files reference in comments." Not deleted — it's
still the readable explanation of *why* each threshold is what it is, which the research explicitly
called out as something every alert should have (a runbook link, not tribal knowledge).

---

## Verification

- `terraform plan` reviewed before first `apply` — confirm it only *creates* resources, touches
  nothing else (this module owns nothing today).
- After apply: use the contact point's "Test" button — but per the research, this only proves the
  Slack/email integration itself works, not that the notification policy actually routes a real
  alert to it. Confirm real routing by temporarily lowering one rule's threshold to something
  already true (e.g. disk-usage warn threshold to `>0`), confirming it fires and reaches Slack, then
  restoring the real value.
- Confirm the synthetic check's first run is green before trusting it as a baseline.
- Confirm both SLOs show non-error burn-rate data (not "no data") within the first evaluation
  window — an SLO pointed at a route with zero traffic just shows blank, which looks like success
  but isn't actually validated.

---

## Open questions for the implementation plan (not this design)

- Exact Terraform variable wiring for the two new secrets (`grafana_auth`, `slack_webhook_url`) —
  local `.tfvars` (gitignored) vs shell env var, matching whatever's least friction for whoever runs
  the apply.
- Exact Grafana Cloud Prometheus/Mimir datasource UID to reference in the SLO resources — needs to
  be looked up in the Grafana Cloud UI once the provider is authenticated, not guessable in advance.
