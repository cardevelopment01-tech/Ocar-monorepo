# Driver Onboarding & City Availability Analytics — Implementation Plan

## Why

Ops asked for one thing: **per-city numbers on driver onboarding and driver availability**, so they know which cities need onboarding push vs. which need supply (more online drivers). Two metrics, not a new analytics platform.

## What already exists (reuse, don't rebuild)

- `driver_status_history` (`driver_id, from_status, to_status, reason, created_at`) — every status transition is already logged. This is the entire onboarding-funnel data source; no new table, no new timestamp columns.
- `drivers.city_id` (nullable FK to `cities`, added in `082_driver_city_id.sql`) — the join key. Nullable for drivers never assigned a city — report these under an **"Unassigned"** bucket, don't drop them.
- `driver_sessions` (`status: online|on_trip|offline`, `went_offline_at`) and `driver_location_snapshots.is_available` — already track "is this driver online / available right now."
- `api/src/modules/analytics/` — repository/service/routes/types already follow the exact pattern needed: `analyticsQuery()` helper (bumps `statement_timeout` via `SET LOCAL`, safe from injection since it's a literal number), `getCityBreakdown()` as the copy-paste template for city-grouped queries.
- `apps/admin/app/(dashboard)/analytics/page.tsx` — the admin "Reports" page already renders period-scoped city breakdowns via a reusable `HBarChart` component, using `recharts` (already a dependency).

**Conclusion: this is two new repository functions + two new endpoints + one new section on the existing Reports page. No new module, no new page, no new dependency.**

## Backend

### 1. `getDriverOnboardingFunnel(days)` — `api/src/modules/analytics/analytics.repository.ts`

Per city, over the period window (drivers who signed up in the window):

```sql
SELECT
  COALESCE(c.name, 'Unassigned')                                    AS city_name,
  COUNT(*)                                                          AS signed_up,
  COUNT(*) FILTER (WHERE docs.driver_id IS NOT NULL)                AS docs_submitted,
  COUNT(*) FILTER (WHERE active.driver_id IS NOT NULL)              AS activated,
  COUNT(*) FILTER (WHERE d.status IN ('suspended','banned'))        AS rejected_or_banned,
  AVG(EXTRACT(EPOCH FROM (active.activated_at - d.created_at)) / 3600)
    FILTER (WHERE active.driver_id IS NOT NULL)                     AS avg_hours_to_active
FROM drivers d
LEFT JOIN cities c ON c.id = d.city_id
LEFT JOIN LATERAL (
  SELECT DISTINCT ON (driver_id) driver_id
  FROM driver_status_history h
  WHERE h.driver_id = d.id AND h.to_status = 'pending_approval'
) docs ON true
LEFT JOIN LATERAL (
  SELECT driver_id, created_at AS activated_at
  FROM driver_status_history h
  WHERE h.driver_id = d.id AND h.to_status = 'active'
  ORDER BY created_at LIMIT 1
) active ON true
WHERE d.created_at >= NOW() - ($1 || ' days')::INTERVAL
GROUP BY c.name
ORDER BY signed_up DESC
```

Returns, per city: `signed_up`, `docs_submitted`, `activated`, `rejected_or_banned`, `avg_hours_to_active`, plus a derived `conversion_pct = activated / signed_up` computed in the service layer (avoid `NULLIF`-in-SQL noise, one line in TS).

### 2. `getDriverAvailability()` — same file, no `days` param (this is a live snapshot, not historical)

```sql
SELECT
  COALESCE(c.name, 'Unassigned')                       AS city_name,
  COUNT(*) FILTER (WHERE d.status = 'active')          AS total_active,
  COUNT(*) FILTER (WHERE ds.id IS NOT NULL)             AS online_now,
  COUNT(*) FILTER (WHERE dls.is_available = true)       AS available_now
FROM drivers d
LEFT JOIN cities c ON c.id = d.city_id
LEFT JOIN driver_sessions ds
  ON ds.driver_id = d.id AND ds.status IN ('online','on_trip') AND ds.went_offline_at IS NULL
LEFT JOIN driver_location_snapshots dls ON dls.driver_id = d.id
WHERE d.status = 'active'
GROUP BY c.name
ORDER BY total_active DESC
```

Returns per city: `total_active`, `online_now`, `available_now`. Service layer derives `availability_pct = available_now / total_active` — this is the number that flags "focus here" (low % = active drivers on paper, not actually on the road).

### 3. Types — `analytics.types.ts`

Add `DriverOnboardingFunnel` and `DriverAvailability` interfaces mirroring the two query shapes above (same style as existing `CityBreakdown`).

### 4. Routes — `analytics.routes.ts`

```
GET /api/v1/admin/analytics/drivers/onboarding?period=7d|30d|90d   (reuse VALID_PERIODS + requireAdmin(...) exactly as /summary does)
GET /api/v1/admin/analytics/drivers/availability                   (no period — live snapshot)
```

Same `authenticate()` + `requireAdmin('super_admin','ops_admin','finance_admin')` guard as the existing two endpoints.

## Frontend

### `apps/admin/lib/admin-api.ts`

Add `adminAnalyticsApi.getDriverOnboarding(period)` and `.getDriverAvailability()`, matching the existing `getSummary`/`getEtaAccuracy` calls. Add the two response types.

### `apps/admin/app/(dashboard)/analytics/page.tsx`

Add one new section, **"Driver Onboarding & Availability"**, below the existing funnel/city/category row:

- Left: onboarding funnel per city — reuse `HBarChart` for a top-line "signed up vs activated" comparison, plus a small table (city, signed up, docs submitted, activated, conversion %, avg hours to active) sorted so low-conversion / high-signup cities surface first — that's literally the "focus here" list ops asked for.
- Right: availability per city — a table (city, total active, online now, available now, availability %), row-highlighted (existing `COLORS.danger`/`COLORS.warning`/`COLORS.success` tokens already used elsewhere in this file) when `availability_pct` drops below a threshold (e.g. <30% red, <50% amber) so low-supply cities are visually obvious without a new chart type.
- Availability section fetches independently of the period selector (it's live) — either poll every 30–60s or add a manual refresh button; don't wire it to the existing `period` state since it has no period.

No new chart library, no new page, no new route in the admin nav — this rides the existing "Reports" page and its existing period selector for the funnel half.

## Sequencing

1. Repository functions + types (backend, testable in isolation via `psql`).
2. Routes + service wiring.
3. Frontend section on the existing page.
4. Manual verification: hit both endpoints against the dev DB, confirm city totals reconcile against `SELECT city_id, status, count(*) FROM drivers GROUP BY 1,2` run by hand.

## Explicitly out of scope (say so, don't build silently)

- No new admin page/route — extends the existing Reports page.
- No CSV export, no scheduled email digest — not asked for; add if ops requests it later.
- No new `system_config`-gated feature flag — this is read-only reporting, no behavior change to gate.
- Historical availability trend (e.g. "availability over the last 30 days" as a time series) is skipped — `driver_location_snapshots`/`driver_sessions` don't retain enough history for that without a new rollup table. If ops wants a trend line later, that's a `driver_availability_daily_snapshot` rollup job — a separate, larger piece of work, not part of this plan.
