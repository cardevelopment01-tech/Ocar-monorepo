# Grafana dashboards

`ocar-overview.json` is edited here, then manually re-imported into Grafana Cloud — there is no
provisioning automation (deliberately, see `docs/superpowers/plans/2026-08-09-grafana-log-level-filter-design.md`).

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
