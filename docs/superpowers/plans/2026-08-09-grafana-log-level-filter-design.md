# Grafana log-level filter for repeatable Viewer access

**Date:** 2026-08-09
**Driver:** Follow-up to `2026-08-08-observability-stack-design.md`. Scrolling the unfiltered "Live Logs"
panel in `ocar-overview.json` to find one error buried between 30s-interval polling noise
(admin SOS badge, unread-count badges) is too slow. Need a self-serve filter for a repeatable
Viewer-role account (future support staff), without granting Explore access or an Editor role.

**Scope:** One dashboard JSON edit + one short ops doc. No app code, no Alloy/infra config change,
no CI/provisioning automation — deliberately, see "Rejected" below.

---

## Change 1 — template variable on `ocar-overview.json`

Add a `templating.list` entry, a `custom` variable named `min_level`:

| Label | Value |
|---|---|
| All | `0` |
| Warnings & Errors | `40` |
| Errors only | `50` |

Default selection: **Errors only**. Values map to Pino's numeric levels (`30`=info, `40`=warn,
`50`=error) — same scheme already used in the LogQL examples given ad hoc in this project's chat
history (`level >= 50`).

## Change 2 — Live Logs panel query

`ocar-overview.json`, panel id `9` ("ocar-api / nginx logs"), `targets[0].expr`:

```diff
- {service="ocar", env="production"}
+ {service="ocar", env="production"} | json | level >= $min_level
```

`level` is not promoted to a Loki label (per the existing spec's MUST-DO #2 cardinality rule) —
this stays a line filter inside the query string, so it costs nothing extra in stream cardinality.

## Change 3 — `infra/grafana/dashboards/README.md`

New file. Documents the two steps repeated for every future support hire, so this isn't tribal
knowledge (same reasoning as MUST-DO #8's "per-server Alloy rollout" doc):

1. Re-importing this JSON after an edit (Grafana Cloud UI → Dashboards → Import → paste JSON,
   same manual process already in use today).
2. Inviting a repeatable Viewer: Grafana Cloud → Administration → Users and access → Invite →
   org role **Viewer** → share the dashboard's direct link.

No Explore access granted or needed — the `$min_level` dropdown is the Viewer's entire filter UI.

---

## Rejected for this change

- **Automated dashboard provisioning (Terraform/Grafana API in CI).** Textbook GitOps, but adds a
  new secret (Grafana service-account key) and a pipeline step for a dashboard that changes rarely.
  Revisit only if manual re-import becomes real friction from frequent edits — not speculatively.
- **Granting Explore or Editor role.** Broader access than the stated need (read filtered errors),
  and defeats the point of a Viewer-safe, self-serve panel.
- **Splitting the log panel by `container` (api vs nginx).** Not asked for; the existing combined
  view already covers "find the error," and splitting it is a separate, unrequested change.

---

## Verification

- Import the updated JSON into Grafana Cloud, confirm the dropdown renders with the three options
  and "Errors only" is selected by default on load.
- Confirm switching to "All" restores the original unfiltered view (i.e., the LogQL is additive,
  not a typo that silently drops everything).
- Invite one real Viewer-role test account, confirm they can see and use the dropdown without
  Explore access.
