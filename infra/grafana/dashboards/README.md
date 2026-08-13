# Grafana dashboards

`ocar-overview.json` is the single dashboard for this project — fleet/autoscaling overview, RED
golden signals, DB pool, BullMQ, per-instance host resources, and live logs, all in one file. It's
edited here, then manually re-imported into Grafana Cloud — there is no provisioning automation
(deliberately, see `docs/superpowers/plans/2026-08-09-grafana-log-level-filter-design.md`).

A separate `ocar-fleet-dashboard.json` briefly existed alongside this one (added during the ASG
migration without realizing this file already covered most of the same ground) and was merged into
this file on 2026-08-13, then deleted. Keep it that way — a second dashboard is exactly how the
Live Logs panel below ended up querying the wrong `env` label for days without anyone noticing:
nothing forced the two files to agree with each other. One file, one source of truth.

## Re-importing after an edit

Grafana Cloud UI → **Dashboards → Import** → paste the contents of `ocar-overview.json` → pick
the existing Prometheus/Mimir and Loki datasources for the `DS_PROMETHEUS`/`DS_LOKI` prompts →
Import (overwrites the existing dashboard of the same name).

## Inviting a repeatable Viewer (support staff)

1. Grafana Cloud → **Administration → Users and access → Invite** → assign org role **Viewer**.
2. Share the dashboard's direct link with them (open the dashboard → share icon → copy link).

No Explore access is granted or needed. The "Live Logs" panel's **Log level** dropdown
(All / Warnings & Errors / Errors only, defaults to Errors only) is the Viewer's entire filter
UI — they never need to write a LogQL query by hand.
