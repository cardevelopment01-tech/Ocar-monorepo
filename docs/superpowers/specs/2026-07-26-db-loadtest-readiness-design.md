# DB Load-Test Readiness — Beyond Migrations 057–061

**Date:** 2026-07-26
**Driver:** Follow-up to `2026-07-26-db-scalability-indexing-design.md`. That pass fixed the *read path* (FK indexes, admin-search trigram indexes, money-column CHECKs, dead-schema drops). This pass is a research audit of what's still missing to survive a client load test at 1M/2M/5M/10M rows — benchmarked against how industry-grade ride-hailing DBs (Uber/Ola/Lyft-scale) are run, then right-sized down to Odisha intercity volume (Bhubaneswar/Cuttack/Puri).

**Scope:** Spec only. No code/migrations written yet — this is the ranked plan the team implements from.

**Method:** Read the actual `.sql` migrations and `*.repository.ts` / `*.service.ts` files (not graphify — it doesn't model SQL). Every claim below was verified against the current code, including the pool config in `api/src/db/client.ts` and worker concurrency in `api/src/jobs/workers/`.

---

## Verified current state (the foundation this builds on)

- `pg.Pool` in `db/client.ts`: `min`/`max` from config, `statement_timeout: 10000ms`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000`. **No `idle_in_transaction_session_timeout`.**
- Three BullMQ workers share that one pool: `dispatch` (concurrency 20) + `gps-flush` (concurrency 20) + `notifications` (5) = **up to 45 concurrent job handlers competing for the pool**, before any HTTP request handler gets a connection. Confirmed in `dispatch.worker.ts:18`, `gps-flush.worker.ts:42`, `notifications.worker.ts:206`.
- Observability is a single `console.warn` on >1000ms queries (`db/client.ts:31`). Nothing else.
- `rides` has good partial indexes (`rides_active_idx`, `rides_user_idx`, etc.) and the 057 FK indexes. **No `fillfactor` and no per-table autovacuum tuning anywhere** — grep confirms zero occurrences across all migrations.
- `driver_location_snapshots`: 1 row/driver, upserted ~every 30s, with a GiST index on `location` (`driver_location_snapshots_gix`) touched on every upsert → cannot HOT-update.
- Wallet debits: `SELECT ... FOR UPDATE` per-driver, single-row (`payments.service.ts:103`, `:538`).
- `ratings_to_driver_idx` / `ratings_to_user_idx` already exist (migration 009) — so item #8 below is cheaper than a from-scratch estimate.

**Bottom line:** 057–061 fixed read-path gaps. The unaddressed risk is entirely **write-path bloat (#3)** and **pool/endpoint config (#1, #2)** — those three are what will actually surface as "the DB is slow" in the load test.

---

## MUST-DO before the client load test

### 1. Split the worker pool from the request pool
**Problem:** 45 potential concurrent DB-touching job handlers + N HTTP handlers, one shared pool. Under load the workers exhaust the pool; request latency spikes as handlers wait `connectionTimeoutMillis` (5s) then error. This makes a *config* problem look like a *DB* problem in the load test.
**Fix:** Two pools — `requestPool`, `workerPool` — sized to Neon's connection ceiling, so batch jobs can't starve user-facing requests. Interacts with #2 (the pooler endpoint changes the ceiling math).
**Effort: low · Impact: high · Type: app-code + config.**

### 2. Confirm `DATABASE_URL` uses the Neon `-pooler` endpoint (transaction mode)
**Problem:** Neon's direct (non-pooler) endpoint caps hard on connections and cold-starts. `.env.example` still shows `localhost:5432`; nobody has documented which Neon host prod uses. If prod is on the direct endpoint, `max` × app-instances connections hit Neon's limit fast.
**Fix:** Use the `-pooler` host (Neon runs PgBouncer in transaction mode). Verified compatible: node-`pg` here uses **unnamed** prepared statements (no `PREPARE`, no named statements), and no code sets session state that must survive across queries (`types.setTypeParser` is client-lib-side, fine; no per-session `SET`). Keep the app `max` modest (10–20/instance) and let Neon's pooler fan out.
**Effort: low · Impact: high · Type: Neon-dashboard + env config.** Verify FIRST — a wrong endpoint invalidates the whole load test.

### 3. `fillfactor` + per-table autovacuum on the three churn tables (highest ROI in this doc)
**Problem:** completely unaddressed. Three tables take constant in-place UPDATEs:
- **`driver_location_snapshots`** — worst. Every driver upserts every ~30s; the indexed `location` (GiST) column means each update is non-HOT → relentless dead-tuple + index bloat; the GiST index degrades and `findNearbyDrivers` (dispatch hot path) slows.
- **`rides`** — 5+ status UPDATEs/row, each mutating indexed columns (status, timestamps in partial-index predicates) → non-HOT.
- **`driver_sessions`** — online/on_trip/offline churn.

**Fix (one migration, `ALTER TABLE ... SET (...)`):**
```sql
-- tiny, brutally hot → vacuum almost constantly
ALTER TABLE driver_location_snapshots SET (
  autovacuum_vacuum_scale_factor = 0.0,
  autovacuum_vacuum_threshold = 50,
  autovacuum_vacuum_cost_delay = 0
);
-- leave room for HOT updates on frequently-updated rows
ALTER TABLE rides           SET (fillfactor = 85, autovacuum_vacuum_scale_factor = 0.02);
ALTER TABLE driver_sessions SET (fillfactor = 85, autovacuum_vacuum_scale_factor = 0.05);
```
`fillfactor` only helps `rides`/`driver_sessions` where a HOT update is *possible* (update touches only non-indexed columns). It does **not** rescue `driver_location_snapshots` (indexed `location`) — there the answer is aggressive autovacuum. Neon runs autovacuum but with generic global settings; per-table overrides are just DDL.
**Effort: low · Impact: high · Type: migration.**

### 4. `getAdminDashboardStats` — kill the function-wrapped date predicates
**Problem:** `admin.repository.ts:1158` — 8 subqueries, several of the form `WHERE (requested_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`. The expression on `requested_at` defeats every index on it → 8 sequential scans of `rides` on every dashboard poll. At 10M rides that's seconds per load, polled continuously by ops.
**Fix:** compute the IST day bounds once (in JS or a CTE) and range-scan:
```sql
WHERE requested_at >= $ist_day_start AND requested_at < $ist_day_start + interval '1 day'
```
`getDriverEarningsSummary` already does the sargable-bounds pattern — mirror it here.
**Effort: low · Impact: high · Type: app-code (query rewrite).**

### 5. Turn on observability BEFORE load-testing
**Problem:** the only instrumentation is the >1000ms `console.warn`. Won't tell you *which* pattern or how often.
**Fix — enable before, read after:**
- `pg_stat_statements` (Neon: enable via extension / settings) — the whole ballgame for finding real slow queries under load.
- `log_min_duration_statement` ~500ms via Neon settings.
- After the run, query `pg_stat_user_indexes` / `pg_stat_user_tables` for (a) **unused indexes** — we added ~15 across 057–059, confirm they're scanned, drop dead weight — and (b) high `n_dead_tup` (validates #3).
**Effort: low · Impact: high · Type: Neon-dashboard setting + post-test analysis.**

### 6. Add `idle_in_transaction_session_timeout`; reconcile `statement_timeout` with analytics
**Problem A:** no `idle_in_transaction_session_timeout` — a slow/buggy client mid-`withTransaction` (used in `acceptAssignment`, wallet debits, settlements) can hold row locks + a connection indefinitely. On the wallet/ride hot path that stalls and cascades.
**Problem B:** the global `statement_timeout: 10000` is right for OLTP but **will kill analytics** (`getDailyRevenue`, `getTopDrivers`, `getCityBreakdown` — full `GROUP BY` scans over N days of `rides`⋈`payments`) once `rides` is large. They'll start erroring at ~10M rows.
**Fix:** add `idle_in_transaction_session_timeout: 15000` to the pool. For analytics, `SET LOCAL statement_timeout` per-query — or better, move them to a read replica (#7) where a longer timeout is safe.
**Effort: low · Impact: med · Type: app-code + config.**

---

## SHOULD-DO (before real traffic, not strictly before the synthetic test)

### 7. Route analytics + admin dashboard to a Neon read replica (CQRS-lite)
**Problem:** `analytics.repository.ts` (5 heavy rolling-window `GROUP BY` aggregations) and `getAdminDashboardStats` run big scans against the same primary serving dispatch and wallet writes → buffer/IO contention with the transactional path.
**Fix:** Neon supports read replicas with their own endpoint. Second read-only pool (`READ_REPLICA_URL`), point analytics + dashboard reads at it. These tolerate slight replica lag (dashboards, not money). Natural home for the long analytics timeout from #6.
**Effort: med · Impact: high · Type: infra (Neon) + app-code (~20 lines).**

### 8. Incremental rating aggregates instead of full `AVG()` recompute
**Problem:** `safety.repository.ts:86` — every new rating runs `UPDATE drivers SET rating_avg = (SELECT AVG(score) FROM ratings WHERE to_driver_id=$1), total_ratings = (SELECT COUNT(*)...)`. A veteran driver re-scans all their ratings on every new one. Index exists (`ratings_to_driver_idx`), but it's still O(ratings-per-driver) per write.
**Fix:** maintain incrementally with a `rating_sum` column — `rating_avg = rating_sum / total_ratings`, O(1) per rating. Ratings are append-only here, so no edit-delta complication. Migration adds `rating_sum` + one backfill.
**Effort: med · Impact: med · Type: migration + app-code.**

### 9. Keyset pagination on admin lists (rides, users, drivers)
**Problem:** `admin.repository.ts` uses `LIMIT $ OFFSET $` on `rides`/`users`/`drivers` lists (lines 97, 849, 1020, 1083) + a `COUNT(*)` companion. `OFFSET 100000` scans and discards 100k rows; the `COUNT(*)` scans the whole filtered set per page. Bites admins paging deep into 10M rides. (Already flagged as a known ceiling in the prior spec.)
**Fix:** keyset/seek (`WHERE (requested_at, id) < ($lastTs, $lastId) ORDER BY requested_at DESC, id DESC LIMIT n`) on existing composite indexes. Drop per-page `COUNT(*)` for an approximate total (`reltuples`) or "load more" UX. User/driver *own* ride history is low priority (nobody pages past a few screens).
**Effort: med · Impact: med · Type: app-code.**

### 10. Partition `ride_status_history` only (not `rides`)
**Problem:** ~5–6 append-only rows per ride → ~60M rows at 10M rides. Pure insert + occasional per-ride read.
**Fix:** RANGE partition by `created_at` monthly, reusing the exact `gps_tracks` machinery already built (partition-creator processor + maintenance worker). Cheap because the pattern exists.
**Effort: med · Impact: med · Type: migration + reuse existing job.**

---

## NICE-TO-HAVE / explicitly PREMATURE — do NOT do now

- **Partition `rides` itself** — skip. At 10M rows a well-indexed `rides` is fine; the active-ride working set is tiny and covered by partial indexes. Partitioning complicates every FK (`fare_snapshots`, `payments`, `ratings`, `ride_status_history` point at it) and the CAS/`FOR UPDATE` flows, for no measurable win. Revisit at 50M+.
- **Partition `notification_logs` / wallet ledgers / `payments`** — skip. The 035 header already reasons this correctly (notification volume ≪ GPS); payments/ledger grow at ride rate, trivially indexable.
- **The wallet `FOR UPDATE` "hotspot"** — not actually a hotspot; do nothing. A driver is only ever on **one ride at a time**, so there's never contention on a given driver's wallet row. It's a per-driver lock with effectively zero concurrency. Advisory locks / lock-free schemes here would be cargo-cult.
- **Covering / `INCLUDE` indexes for ride history** — skip for now. `getUserRideHistory` / `getActiveRideForDriver` join `fare_snapshots`/`drivers`/`payments`, so an index-only scan on `rides` alone can't satisfy them — joins force heap access regardless. One thing worth measuring *post*-load-test: `rides_active_idx INCLUDE (driver_id, user_id)` if `pg_stat_statements` shows the dispatch lookup heap-bound — but prove it first.
- **Settlements N+1 loop** (`settlements.service.ts:136`) — leave it. Nightly batch cron, not a request path; per-driver locking is deliberate for correctness.
- **Self-hosted PgBouncer / sharding / Citus** — skip. Neon's built-in pooler (#2) is the PgBouncer you need. Sharding at 10M rows for one Indian state is absurd.

---

## One-glance priority table

| # | Item | Effort | Impact | Type | Bucket |
|---|------|--------|--------|------|--------|
| 1 | Split worker pool from request pool | low | high | app+config | MUST |
| 2 | Neon `-pooler` endpoint + verify txn-mode | low | high | Neon/env | MUST |
| 3 | fillfactor + per-table autovacuum (snapshots/rides/sessions) | low | high | migration | MUST |
| 4 | Sargable date ranges in dashboard stats | low | high | app-code | MUST |
| 5 | pg_stat_statements + slow-query log + index-usage audit | low | high | Neon setting | MUST |
| 6 | idle_in_txn timeout; reconcile statement_timeout vs analytics | low | med | app+config | MUST |
| 7 | Analytics/dashboard → Neon read replica | med | high | infra+app | SHOULD |
| 8 | Incremental rating aggregates | med | med | migration+app | SHOULD |
| 9 | Keyset pagination on admin lists | med | med | app-code | SHOULD |
| 10 | Partition `ride_status_history` only | med | med | migration | SHOULD |

**Recommended sequencing:** do #2 and #5 first (they're Neon-dashboard settings and gate the whole test — you can't measure without #5, and #2 invalidates results if wrong). Then bundle #1/#3/#4/#6 as one code+migration PR. Run the load test. Read `pg_stat_statements`. *Then* decide on the SHOULD-DO items based on what the test actually showed — don't build #7–#10 blind.
