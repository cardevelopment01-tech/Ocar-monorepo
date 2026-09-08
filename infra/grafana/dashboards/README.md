# Grafana dashboards

`ocar-overview.json` is the single dashboard for this project — fleet/autoscaling overview, RED
golden signals, DB pool, BullMQ, per-instance host resources, and live logs, all in one file. It's
edited here, then applied via Terraform (`infra/terraform/observability/dashboards.tf`) — this
superseded manual re-import on 2026-09-08. The original "no provisioning automation" call
(`docs/superpowers/plans/2026-08-09-grafana-log-level-filter-design.md`) was deliberate at the
time (dashboard changed rarely); it was revisited once staging's destroy/rebuild cycle made manual
re-import a real, repeatedly-forgotten step.

A separate `ocar-fleet-dashboard.json` briefly existed alongside this one (added during the ASG
migration without realizing this file already covered most of the same ground) and was merged into
this file on 2026-08-13, then deleted. Keep it that way — a second dashboard is exactly how the
Live Logs panel below ended up querying the wrong `env` label for days without anyone noticing:
nothing forced the two files to agree with each other. One file, one source of truth.

## Applying an edit

`ocar-overview.json` has a fixed `uid` (`ocar-overview`) — the `grafana_dashboard` Terraform
resource matches on this uid, so `terraform apply` updates the same dashboard in place rather than
creating a new one. The Grafana API doesn't resolve the `${DS_PROMETHEUS}`/`${DS_LOKI}` `__inputs`
placeholders the way the old manual "Dashboards → Import" UI flow did — Terraform substitutes the
real datasource UIDs (from `/ocar/observability/{prometheus,loki}-datasource-uid` in SSM) before
pushing.

```powershell
cd infra/terraform/observability
terraform plan   # review the diff
terraform apply
```

Applied locally, not from CI — same convention as the rest of this module (see `providers.tf`).

## Inviting a repeatable Viewer (support staff)

1. Grafana Cloud → **Administration → Users and access → Invite** → assign org role **Viewer**.
2. Share the dashboard's direct link with them (open the dashboard → share icon → copy link).

No Explore access is granted or needed. The "Live Logs" panel's **Log level** dropdown
(All / Warnings & Errors / Errors only, defaults to Errors only) is the Viewer's entire filter
UI — they never need to write a LogQL query by hand.
