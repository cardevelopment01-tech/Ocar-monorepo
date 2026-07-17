# GPS Trip-Replay for Disputes — Design Spec

**Date:** 2026-07-17
**Status:** Approved
**Author:** Claude (with Sujal Kumar Ghosh)

## Problem

`gps_tracks` (breadcrumb GPS pings, one per ~30s of active ride, `api/src/db/migrations/005_m3_geo.sql`) is currently **write-only** — two workers insert into it (`gps-flush.worker.ts`, `geo.repository.ts`) but nothing in the codebase ever reads from it. It is monthly range-partitioned, but partition auto-creation was never wired up (existing audit finding, `PERFORMANCE_AUDIT.md` §0.1) — inserts will start failing ~3-4 months after any deploy once pre-created partitions run out. Separately, `docs/decisions/ADR-003-monthly-partitioning.md` specifies a 12-month retention/purge policy that was designed but never implemented — the table grows unbounded today.

Meanwhile, the disputes module (`api/src/modules/safety`) is live in production, but the admin dispute detail page (`apps/admin/app/(dashboard)/disputes/[id]/page.tsx`) is a stub ("Dispute detail coming soon"), and the dispute list's slide-over shows only text addresses — no map, no route, no way to verify a rider's claim like "the driver took a longer route" or "I was overcharged."

## Goals

1. Fix partition auto-creation so `gps_tracks` inserts never fail on a calendar timer (closes audit 0.1).
2. Implement the retention policy that was designed but never built, so the table doesn't grow unbounded.
3. Give admins a trip-replay view on the dispute detail page: the actual driven path (from `gps_tracks`) overlaid with the planned route, with animated playback.

## Non-goals

- SOS trail, live-map actual-path overlay, fare-distance verification, and analytics use of `gps_tracks` — real candidates (see research below) but out of scope for this pass. Each would reuse the read path built here but is its own follow-up.
- Map-matching / road-snapping of the replay trail via Google Roads API. Pings are already 30s apart (not the noisy 3s live-tracking case); raw pings are used directly. Revisit only if manual review shows the animated trail looking visibly wrong (e.g. cutting through buildings) — not a speculative requirement today.
- Downsampling/aggregating old pings before purge (an ADR-003-adjacent idea). Nothing today consumes historical aggregate GPS data — building a rollup pipeline for a non-existent consumer is the same premature-scaling mistake as the original unused partitioning. Documented as a future trigger, not built now.

## Research summary (informing this design)

External (Uber/Lyft/Grab engineering blogs, cited in full in conversation history):
- Raw GPS trails are used industry-wide for dispute resolution/trip replay, fraud detection, and fare verification — this is a standard capability, not speculative.
- Raw pings are noisy; production systems map-match before treating them as ground truth for anything besides rough visual replay.
- Retention is bounded (weeks–months for raw pings, longer for trip summaries) — nobody keeps raw GPS forever; storage/privacy cost isn't worth it past the point disputes/investigations are realistically filed.
- Live tracking (hot, high-write) and historical trail (cold, occasional-read) are architecturally separated — matches our `driver_location_snapshots` (live, one row per driver) vs. `gps_tracks` (historical, append-only) split, which already exists.

Codebase findings:
- `driver_location_snapshots` (from `007_m5_booking.sql`) powers the live map today — one row per driver, upserted. Not affected by this change.
- Disputes have zero location data currently; SOS stores only a single trigger-point lat/lng, no trail (out of scope here, noted as a follow-up candidate).
- `LiveMap.tsx` already has map canvas + polyline-drawing code, reusable for the replay view.

## Environment note

Development currently runs on Neon's free tier (512MB/project, shared across all tables). At the volume `gps_tracks` was designed for (~450k rows/day per the migration's own comment), even a few days of unpurged data would consume a large fraction of that cap. This is a non-issue for the design itself since production will move to a paid Neon plan before this matters at real volume — noted here only so the dev-environment constraint isn't confused with an architectural requirement. If free-tier storage pressure becomes a problem during development before the purge job is deployed, the pragmatic move is a manual `DELETE`/shorter interim retention on the dev DB, not a design change.

## Design

### A. Partition lifecycle — two scheduled jobs

**`gps-partition-maintenance`** (BullMQ repeatable, monthly): calls the existing `create_gps_partition(year, month)` SQL function (already defined in `005_m3_geo.sql`, currently called from nowhere) to pre-create next month's partition ahead of time. Idempotent (`CREATE TABLE IF NOT EXISTS` under the hood) — safe to re-run if the job fires twice. Lives in `api/src/jobs/` next to the existing GPS-flush worker, reusing the existing BullMQ queue infra.

**`gps-partition-purge`** (BullMQ repeatable, monthly, scheduled after maintenance): queries `pg_inherits`/`information_schema.tables` for `gps_tracks_YYYY_MM` partitions whose full date range is older than the retention window, then `DROP TABLE`s each. No hardcoded partition list — derives what to drop from actual DB state, so it can't drift out of sync. Logs dropped partition names + estimated row counts for an audit trail.

**Retention window: 90 days.** Chosen over ADR-003's original 12 months because disputes are realistically filed within days to a few weeks of a ride; 90 days gives generous buffer without holding data with no in-use consumer. This is a named constant, easy to change later if a longer window becomes a requirement (e.g. legal/compliance).

### B. Read path — dispute trip-replay endpoint

`GET /api/v1/admin/disputes/:id/trip-replay`

1. Look up the dispute's `ride_id` (existing dispute lookup).
2. `SELECT location, recorded_at, speed_kmph, heading FROM gps_tracks WHERE ride_id = $1 ORDER BY recorded_at`.
3. Also fetch the planned route polyline via the existing `/geo/route` logic (already used by the live map), so the response carries both "planned" and "actual" for comparison.
4. Return both as JSON: `{ actualTrail: [{lat, lng, recordedAt, speedKmph, heading}], plannedRoute: <existing polyline shape> }`.

**Edge cases:**
- Ride has zero GPS pings (short ride, or ride predates this feature, or trail already purged past 90 days) → `actualTrail: []`. Frontend shows "no trail available for this ride" instead of attempting to render an empty animation.
- A ride's pings span a partition boundary (started near midnight on month-end) → transparent to this query; Postgres reads both partitions, no special handling needed.

Auth: admin-only, reuses existing admin auth middleware — same pattern as other `/api/v1/admin/*` routes.

### C. Frontend — animated playback on dispute detail page

Replaces the stub at `apps/admin/app/(dashboard)/disputes/[id]/page.tsx`. Reuses `LiveMap.tsx`'s map canvas and polyline-drawing utilities rather than a new map component.

- Fetches `trip-replay` data on page load.
- Renders both polylines: actual path (from pings) and planned route (from `/geo/route`), visually distinguished (e.g. different colors), so route deviation is visible even before pressing play.
- Play/pause + scrubber control that interpolates a driver-marker's position between consecutive `gps_tracks` points on a timer — standard video-player-like UX, not a from-scratch animation engine.
- Empty state: "No GPS trail available for this ride" when `actualTrail` is empty.

### D. Testing

Per the one-runnable-check bar (non-trivial branch/loop/destructive-operation gets one test, not a full suite):

- **Purge job partition selection** — the one destructive branch (`DROP TABLE`). Test against a set of fake partition names/date ranges, assert it selects exactly the ones fully older than the 90-day cutoff and never the current/future ones.
- **Partition maintenance idempotency** — smoke check that calling `create_gps_partition` twice for the same month doesn't error.
- Frontend playback component: no dedicated test — it's UI composition over already-tested map primitives (`LiveMap.tsx`'s existing polyline/canvas code).

## Open questions / future triggers

- SOS trail, live-map actual-path overlay, fare-distance cross-check, and analytics use of `gps_tracks` are real, research-backed candidates for follow-up passes — each reuses the read path built here.
- Pre-purge downsampling (ADR-003-adjacent): revisit only if a future feature actually needs historical (>90 day) aggregate GPS data. Not built speculatively.
- Trail snapping/map-matching: revisit only if raw-ping playback visibly looks wrong in practice (e.g., cutting through buildings) after this ships.
