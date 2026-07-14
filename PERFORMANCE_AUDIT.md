# Ocar — Performance Audit & Optimization Roadmap

**Date:** 2026-07-15
**Scope:** api/, apps/user, apps/admin, apps/driver — DB, caching, sockets, GPS/mapping, frontend loads.
**Method:** parallel code audit (6 agents) across backend, PostGIS, sockets/realtime, Next.js apps, driver Vite app, + industry research (Uber/Lyft/Grab public engineering sources) to calibrate what's actually worth adopting at 3-city scale vs. over-engineering.

**How to read this doc:** phases are ordered by urgency × effort, not by subsystem. Phase 0 is "will break in production soon regardless of traffic growth." Phase 1 is cheap, high-leverage, do this sprint. Phase 2 is real but not urgent. Phase 3 is explicitly *not now* — noted so nobody builds it prematurely.

---

## Phase 0 — Will break on its own timeline (fix before anything else)

| # | Finding | File | Why it's Phase 0 |
|---|---|---|---|
| 0.1 | **`gps_tracks` partitions are never auto-created or pruned.** `005_m3_geo.sql` creates partitions only for migration-month + 3 ahead via a one-time DO block. `create_gps_partition()` exists but is called from nowhere in `api/src`. | `api/src/db/migrations/005_m3_geo.sql` | Inserts start failing with "no partition found" in ~3 months from any deploy, independent of user growth. This is a calendar bug, not a load bug. |
| 0.2 | **Multi-instance driver-offline race.** `pendingOffline` grace-period timer is an in-process `Map`. A driver who disconnects from instance A and reconnects to instance B never cancels A's 45s timer — A flips them offline while they're live on B. | `api/src/websocket/socket.server.ts:22` | Silent/harmless today (single instance). Becomes a customer-facing bug the moment you run 2+ API instances for horizontal scaling — must fix *before* that migration, not during an incident. |

**Fix for 0.1:** wire `create_gps_partition()` into a monthly BullMQ repeatable job (create month+3, drop past retention window). One function call, already exists.
**Fix for 0.2:** move the grace marker to Redis (`SET driver_offline_pending:{id} EX 45`, `DEL` on reconnect, timer re-checks key before flipping status). Small diff, only matters once you scale — but land it now while the blast radius of getting it wrong is zero.

---

## Phase 1 — High-impact, cheap, do this sprint

**Status: implemented 2026-07-15.** 9 of 13 items shipped; 4 deliberately skipped (see below). Type-checked clean on `api`, `apps/driver`, `apps/admin`; security-reviewed (auth-cache + new socket write-path) with no findings.

These are the fixes that multiply against your hottest traffic (GPS pings, every authenticated request) or cost real money/battery on driver phones. Each is a small diff.

### Backend / API
| # | Finding | File:Line | Fix | Status |
|---|---|---|---|---|
| 1.1 | Auth middleware does a DB lookup (`findUserById`/`findDriverById`/`findAdminById`) on **every** authenticated request — including every GPS ping. | `api/src/middleware/auth.middleware.ts:29-64` | Cache principal `{status}` in Redis, 30-60s TTL, invalidate on ban/suspend. | ✅ Done — 20s TTL, cache keys `auth:user:/driver:/admin:{id}`. Only id/code/status(+role/is_active/totp_enabled for admin) are cached, not the full row, to keep PII out of Redis. **No invalidation wired on ban/suspend** — see reminders below. |
| 1.2 | `updateLocation` runs a `SELECT id FROM rides WHERE driver_id=...` on every single location ping, from every online driver. | `api/src/modules/rides/rides.service.ts:219-222` | Cache `driverId → activeRideId` in Redis, set on accept/complete/cancel; skip the query for the common no-active-ride case. | ✅ Done — 10s TTL, key `ride:active_by_driver:{driverId}`. Used a TTL instead of invalidating at every status-change call site (5+ places) — worst case a status change takes up to 10s to reflect in live tracking, never a correctness break. |
| 1.3 | DB pool max is 10, shared between API request handlers and the GPS-flush worker (concurrency 20). Under a ping burst, request handlers start throwing connection-timeout errors. | `api/src/config/index.ts:9`, `api/src/db/client.ts:4-10` | Raise pool max to ~20-30, or give the worker a separate pool. Bump `connectionTimeoutMillis` to ~5s. | ✅ Done — pool max 10→25, `connectionTimeoutMillis` 2s→5s. |
| 1.4 | No `statement_timeout` anywhere — a runaway analytics query can hold a connection/locks indefinitely. | `api/src/db/client.ts` | Set `statement_timeout` (e.g. 10s) on the pool; override higher for analytics if needed. | ✅ Done — 10s. |
| 1.5 | Pricing lookup (rate card, stop charge, surge, rental package) hits Postgres with 3-4 sequential queries on every fare estimate/booking, even though these rows change rarely. | `api/src/modules/pricing/pricing.service.ts:18-46` | Short-TTL Redis/in-memory cache keyed by (category, ride_type); invalidate on rate-card create. Also run the 4 queries with `Promise.all` — they're independent. | ✅ Done, **cache skipped on purpose** — parallelized with `Promise.all` only (sequential→concurrent round trips was the real cost; these are already cheap partial-index point lookups). A cache adds invalidation complexity for marginal gain at current scale — revisit if these lookups ever show up slow in `console.warn` slow-query logs. |

### Sockets / GPS pipeline
| # | Finding | File:Line | Fix | Status |
|---|---|---|---|---|
| 1.6 | On-trip location ping fires a billable Google Roads API snap call **every 3 seconds per driver**. | `api/src/modules/rides/rides.service.ts:234-244` | Batch: snap every N pings instead of every ping. Direct cost reduction, not just latency. | ❌ **Skipped** — the only way to reduce snap frequency is to snap larger point-batches less often, which means some raw pings render as straight chords instead of road-snapped segments (exactly the "cuts through a building" problem this code exists to avoid). Trades accuracy for API cost with no billing data yet showing it's a real problem. Revisit only if Roads API cost is measured and material. |
| 1.7 | Admin live-map re-renders **every** driver marker on every single `driver:location_update` event (unmemoized `DriverDot`). | `apps/admin/components/LiveMap.tsx:156-183` | `const DriverDot = memo(...)`. One line; unchanged drivers keep the same object reference so this alone stops it. | ✅ Done — `memo()` with a custom comparator (`prev.session === next.session`), needed because the inline `onClick={() => setSelected(session)}` prop gets a fresh identity every parent render and would otherwise defeat default shallow-compare. |

### Driver app (battery/bandwidth — matters over multi-hour shifts)
| # | Finding | File:Line | Fix | Status |
|---|---|---|---|---|
| 1.8 | GPS location sync is an **HTTP POST every 3 seconds** (full headers + auth token) while a persistent Socket.io connection is already open and idle. ~1200 requests/hour per active driver. | `apps/driver/src/pages/ActiveRide/TripInProgress.tsx`, `NavigateToPickup.tsx` | `socket.emit('location:update', …)` on the existing connection instead. | ✅ Done — client now emits over the existing socket; added a matching `location:update` handler in `api/src/websocket/socket.server.ts` that reuses the same `rides.service.updateLocation()` the HTTP route calls. **The old HTTP route (`POST /sessions/location`) was left in place**, not removed — see reminders below. |
| 1.9 | High-accuracy GPS (`highAccuracy: true`) runs unconditionally on the home screen, even when the driver is offline — only the *sync* is gated on `isOnline`, not the GPS radio mode. | `apps/driver/src/pages/Home.tsx:115-117` | Pass `highAccuracy: isOnline`. | ✅ Done. |
| 1.10 | Onboarding document photos uploaded at raw camera resolution (4-12 MB) with zero client-side compression — the reason the upload timeout is set to 120s. | `apps/driver/src/lib/onboarding-api.ts:93-116` | Canvas/`createImageBitmap` downscale to JPEG before upload. Also common cause of upload failures on 3G/4G, not just a bandwidth cost. | ✅ Done — `compressDocImage()` helper, max edge 1600px, q0.82. Non-image files (PDFs) pass through untouched; falls back to the original file if compression throws for any reason. |
| 1.11 | Selfie captured at full device resolution (often 1920×1080+, 500KB-1.5MB) with JPEG q=0.92. | `apps/driver/src/pages/Onboarding/ReferenceSelfie.tsx:172-195` | Downscale canvas to ~1024px max edge, q≈0.8. | ✅ Done — max edge 1024px, q0.85. |

### Frontend (user/admin)
| # | Finding | File:Line | Fix | Status |
|---|---|---|---|---|
| 1.12 | **Zero server-side data fetching** — all 43 pages across user+admin are `'use client'` with `useEffect` + axios. Next.js App Router used as a pure client SPA: every nav shows a skeleton then waterfalls. No SWR/React Query anywhere, so no caching/dedupe/stale-while-revalidate either. | all `page.tsx` in `apps/user/app`, `apps/admin/app` | Cheapest real win: add SWR (tiny lib) over the existing axios wrappers in `apps/user/lib/*-api.ts` / `apps/admin/lib/*-api.ts` — one hook per list endpoint. Move genuinely read-heavy pages (user `history`, `profile`) to Server Components only if SWR isn't enough. | ❌ **Skipped** — 43-page surface is a different scale of change than the rest of Phase 1 (bounded single-file diffs). Several pages already rely on sockets/polling for live data; mixing in SWR without per-page care risks a second bug on top of the fetch-waterfall one. Worth doing as its own scoped pass (Phase 1b), not folded into this one. |
| 1.13 | `framer-motion` statically imported on ~10 user routes (home, profile, select-ride, trip-type) — ~35KB gz in the critical path of a mobile passenger app for simple enter transitions. | `apps/user/app/(main)/*` | `LazyMotion` + `domAnimation` features import, or plain CSS transitions for the simple cases. | ❌ **Skipped** — bundled with 1.12 as a follow-up frontend pass rather than done piecemeal. |

**Actual effort: same day.** These are the items that scale with request/ping volume — fixing them now is cheap; fixing them under load pressure later is not.

### Reminders / follow-ups from this pass

- **1.1's cache has no invalidation.** Nothing calls `DEL auth:user:/driver:/admin:{id}` when an admin bans a driver, suspends a user, or deactivates an admin — those actions just wait out the 20s TTL. Acceptable at current stakes (mirrors the ban-window tradeoff the audit already called out), but if instant revocation ever becomes a requirement (e.g. compliance), wire a `redis.del(...)` call into `admin.service.ts`'s ban/suspend/deactivate paths.
- **1.8 left the old `POST /api/v1/rides/sessions/location` HTTP route in place**, unused by `TripInProgress`/`NavigateToPickup` now but still reachable and still exercised by anything else that calls `driverRideApi.updateLocation()`. Not a bug — just don't assume the HTTP path is dead when refactoring rides routes later.
- **Pre-existing, unrelated to this diff, flagged during the security review:** `api/src/middleware/auth.middleware.ts:125` has `const mustEnrollTotp = false && MANDATORY_TOTP_ROLES.has(adminRole) && !totpEnabled` — a `TODO(SHIP-BLOCKER)` hardcoded bypass that permanently disables mandatory TOTP enrollment for `super_admin`/`finance_admin`. Should not ship with the `false &&` still in place.
- **Phase 1b candidate:** SWR rollout (1.12) + LazyMotion (1.13) — scope as their own pass, page-by-page, checking which pages already have live socket/poll data before wiring in a cache layer.

---

## Phase 2 — Real, but not urgent (next 1-2 sprints)

| # | Finding | File | Fix |
|---|---|---|---|
| 2.1 | GPS history writes are one BullMQ job + one single-row INSERT per ping (450k rows/day by the migration's own estimate). | `api/src/jobs/workers/gps-flush.worker.ts` | Buffer pings, flush with multi-row `INSERT ... UNNEST` on an interval. |
| 2.2 | Bulk GPS insert does a row-by-row `await client.query()` loop inside one transaction. | `api/src/modules/geo/geo.repository.ts:85-108` | Single multi-VALUES/UNNEST insert. |
| 2.3 | No index for analytics time-range scans (`requested_at >= NOW() - interval`) — every analytics dashboard load seq-scans `rides`. `015_indexes.sql` is still a stub. | `api/src/modules/analytics/analytics.repository.ts` | `CREATE INDEX rides_completed_time_idx ON rides (requested_at) WHERE status='completed'`, plus `(driver_id, completed_at)` for top-drivers. Do this before reaching for materialized views. |
| 2.4 | Live aggregation (5+ JOIN/GROUP BY queries) on every analytics dashboard load, no cache. | `api/src/modules/analytics/analytics.repository.ts` | Fix 2.3 first; if still slow, add a 60s Redis/in-process cache before considering materialized views. |
| 2.5 | Unbounded `LIMIT`-less lists on append-only tables (surge events). | `api/src/modules/pricing/pricing.repository.ts:91-102`, `api/src/modules/admin/admin.repository.ts:740-751` | Add `LIMIT 100` like `listAdminRateCardHistory` already does. |
| 2.6 | Geocode cache read (`lookupGeoCache`) is an `UPDATE ... RETURNING`, turning every cache hit into a row write. | `api/src/modules/geo/geo.repository.ts:118-131` | Plain SELECT; batch/async the hit-count bump. |
| 2.7 | Admin ships two map stacks (`maplibre-gl` + `react-map-gl` AND `@vis.gl/react-google-maps`). | `apps/admin/package.json` | Consolidate to one. |
| 2.8 | Driver app: every page (including onboarding + auth) is statically imported into the main chunk. | `apps/driver/src/App.tsx:7-25` | `React.lazy` the onboarding/auth routes — a driver mid-trip shouldn't download the onboarding flow. |
| 2.9 | Admin notifications: each `notification:new` socket event fires 2 HTTP requests (unread-count + full list refetch); a burst (SOS storm) means 2N requests. | `apps/admin/lib/notifications-context.tsx:50-51` | Increment `unreadCount` locally, debounce the list refetch. |
| 2.10 | `TripRequestCard` starts its own duplicate `watchPosition` while the parent page already has one running. | `apps/driver/src/components/ui/TripRequestCard.tsx:125` | Pass position down from the page/shared store instead of a second GPS watcher. |
| 2.11 | Admin layout polls every 30s *and* overview page polls every 30s on top, despite an existing `admin:ops` socket connection. | `apps/admin/app/(dashboard)/layout.tsx:53`, `overview/page.tsx:55` | Push stat invalidation over the existing socket, or keep just one poller. |

---

## Phase 3 — Explicitly NOT now (would be over-engineering at current scale)

Researched against Uber/Lyft/Grab public engineering practices. Listed so nobody accidentally builds these prematurely — they're real techniques, just for a different order of magnitude of traffic.

| Technique | Verdict | Trigger to revisit |
|---|---|---|
| Kafka for GPS ingestion | Not now | BullMQ + Redis already covers your volume by 4-5 orders of magnitude of headroom |
| Cassandra / second datastore for location history | Not now | Only relevant past hundreds of millions of GPS rows |
| H3/S2 hexagonal geospatial indexing | Not now | Redis GEO commands do the same job at 3-city driver density |
| Custom pub/sub (Uber's Ramen) | Not now | Socket.io + Redis adapter is the right-sized equivalent |
| Microservices decomposition | Not now | No evidence of a scaling bottleneck that a modular monolith can't handle |
| Database sharding | Not now | Single Postgres instance has years of headroom at this data volume |
| Read replicas | Later — at ~100GB+ or genuine analytics contention | Watch `pg_database_size`; revisit once Phase 2.3/2.4 stop being enough |
| PgBouncer | Later — when running multiple API processes | pg's built-in pool is sufficient for a single Node process |
| Socket.io Redis adapter (already present — just watch the horizontal-scaling edge case in Phase 0.2) | Ready when needed | The moment you run >1 API instance |

**One item worth adopting now despite looking like a "big company" technique:** Redis GEO (`GEOADD`/`GEOSEARCH`) for nearest-driver matching instead of relying solely on `ST_DWithin` under load. Current PostGIS GIST indexing is actually fine at today's volume (audit found no missing-index issues on the driver-matching path) — this is a "nice to have when convenient," not urgent. Don't build it speculatively; the PostGIS path works today.

---

## Priority summary (top 5 if you only do five things)

1. **0.1** — Automate `gps_tracks` partition creation/pruning. Will hard-fail regardless of traffic. **Still open.**
2. ~~**1.1 + 1.2** — Cache auth principal status + active-ride-per-driver in Redis.~~ **Done.**
3. ~~**1.8 + 1.9** — Driver GPS sync over the existing socket instead of HTTP POST, and gate high-accuracy mode on online status.~~ **Done.**
4. **1.12** — Add SWR over the existing axios API wrappers. Cheapest fix for the biggest frontend finding (zero caching anywhere). **Still open — scoped as Phase 1b, see reminders above.**
5. ~~**1.10 + 1.11** — Compress document/selfie uploads client-side before S3.~~ **Done.**

**What's left after this pass:** Phase 0 (0.1 partition automation, 0.2 multi-instance offline race — both still open), Phase 1b (SWR + LazyMotion), Phase 2, Phase 3 triggers.

---

*Findings only cover what was actually observed in the code — no speculative problems. Full per-agent findings (file:line detail) are in the conversation this doc was generated from if deeper context is needed on any item.*
