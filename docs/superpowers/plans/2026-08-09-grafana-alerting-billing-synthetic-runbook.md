# Grafana Cloud alerting, billing alerts, synthetic check — runbook

> **Superseded 2026-08-16:** provisioning now happens via Terraform in
> `infra/terraform/observability/` — see
> `docs/superpowers/specs/2026-08-16-grafana-cloud-alerting-terraform-design.md` and
> `docs/superpowers/plans/2026-08-16-grafana-cloud-alerting-terraform.md`. This document is kept as
> the per-rule rationale (why each threshold/route/window was picked) that the Terraform files
> reference in comments — do not use it as the provisioning method anymore.

**Date:** 2026-08-09
**Driver:** Closes MUST-DO #6/#7 and SHOULD-DO #8/#11 from
`docs/superpowers/specs/2026-08-08-observability-stack-design.md`. Researched 2026-08-09: **Grafana
Cloud does not support file-based alert provisioning** (only Terraform or the Alerting HTTP API) —
both were already rejected for the dashboard (`2026-08-09-grafana-log-level-filter-design.md`) as
unneeded ops surface for a team with no dedicated ops person. Same call applies here: this is a
manual UI runbook with exact values, not automation, so it's copy-paste instead of tribal knowledge.

**Scope:** No app code. Real metric/route names below are already live (`api/src/observability/metrics.ts`,
`api/src/app.ts`'s route-labeled histogram) — nothing here needs new instrumentation.

---

## #6 — Baseline alerting (Grafana Cloud Alerting UI)

Grafana Cloud → **Alerting → Alert rules → New alert rule**. Datasource for all of these is the
Prometheus/Mimir one already wired in `infra/alloy/config.alloy`'s `prometheus.remote_write`.

### 1. Error-rate spike — rides & payments
```promql
sum(rate(http_request_duration_seconds_count{route=~"/api/v1/rides.*|/api/v1/payments.*", status_code=~"5.."}[5m]))
/
sum(rate(http_request_duration_seconds_count{route=~"/api/v1/rides.*|/api/v1/payments.*"}[5m]))
```
Warn at `> 0.05` (5%) for `5m`. Critical at `> 0.15` (15%) for `2m`. These two routes were picked
because they're the two flows where a 5xx directly means a stuck ride or a failed payment, not a
cosmetic error.

### 2. `pg.Pool` exhaustion
```promql
pg_pool_connections{state="waiting"}
```
Warn at `>= 3` for `5m`. Any sustained queue for a connection means requests are already waiting
behind the pool, not just "pool is busy" — this is a leading indicator, not a lagging one.

### 3. GPS-flush write latency (`driver_location_snapshots`)
```promql
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket{route="/api/v1/geo/tracks/flush"}[5m])) by (le)
)
```
Warn at `> 1` (1 second p95) for `5m`. This route is hit every 30s per active trip — a slow p95
here means GPS breadcrumbs are falling behind, which is the same data the round-trip overage
billing fallback in CLAUDE.md's Pending Ops Actions depends on.

### 4. Host disk usage
```promql
100 - ((node_filesystem_avail_bytes{mountpoint="/"} * 100) / node_filesystem_size_bytes{mountpoint="/"})
```
Warn at `> 85%` for `10m`. `node_exporter` is already scraped per the metrics spec item.

### Contact point
Use **email** as the contact point (zero new setup — no Slack app/webhook exists in this repo
today). Upgrade to a Slack webhook contact point later if a real ops channel gets created; don't
build that integration speculatively.

---

## #7 — Billing/usage alert at ~80% of free-tier caps

Grafana Cloud → **Billing/Usage dashboard** → pick a panel (Metrics active series / Logs GiB /
Traces GiB) → vertical ellipsis → **More… → New alert rule**.

Set the **planned monthly usage threshold to the free-tier cap itself** — `10000` for metrics
active series, `50` (GiB) for logs, `50` (GiB) for traces — then accept the suggested alert levels
at **50% / 70% / 85%** of that budget. Using the cap as the budget means the 85% level fires at
~42.5GB/8,500 series, comfortably before the hard 50GB/10k cutoff, with no separate math to get
wrong. Do this the same day, for all three signals — it's the exact "first anyone hears about a
surge is an invoice" scenario CLAUDE.md's Pending Ops Actions already flags.

---

## #11 — Synthetic uptime check on `/health`

Grafana Cloud → **Synthetics → Create check → HTTP**.

- **Target:** `https://ocar-api.clienttesting.in/health`
- **Frequency:** 60s
- **Probes:** pick 3+ public probes geographically close to the user base (Mumbai/Singapore if
  available) — this is an intercity Odisha platform, a probe check from São Paulo tells you nothing
  useful about real user reachability.
- **Assertions:** status code `200`, response body contains `"status":"ok"` (matches the literal
  JSON shape returned by `app.ts`'s `/health` handler).
- **Bonus, same check, no extra cost:** enable the **TLS certificate expiry** assertion. As of the
  2026-08-13 ALB migration, TLS terminates at the ALB via an ACM certificate that AWS auto-renews —
  `nginx`/Let's Encrypt/`certbot` no longer run at all (the old `infra/nginx/nginx.prod.conf` setup
  is retired; `user_data.sh.tpl` only starts `api alloy node_exporter` on the new ASG instances).
  The assertion is still worth keeping as defense in depth (catches an ACM renewal failure or a
  future misconfiguration too), just not for the original certbot-can-silently-fail reason.
- **Alert:** fail from ≥2 probes sustained 5m → same email contact point as #6.

---

## #8 — Document the per-server Alloy rollout

New file: `infra/alloy/README.md` (added alongside this runbook — see repo).

---

## Verification

- Trigger each alert rule's threshold manually once where safe (e.g. temporarily lower the disk
  alert threshold to something already true, confirm it fires, then restore the real value) —
  don't ship an alert rule you've never seen actually fire.
- Confirm the email contact point receives a real test notification (Alerting UI has a "Test"
  button per contact point).
- Confirm the synthetic check's first run is green before trusting it as a baseline.
