# DB Scalability & Indexing Strategy — Design

**Date:** 2026-07-26
**Driver:** Client asked for a DB readiness review ahead of a call requesting DB access — specifically (1) static vs dynamic table classification, (2) which tables each flow touches, (3) integrity/constraint review, (4) load-testing readiness at 1M/2M/5M/10M rows. This spec covers items 3 and 4, plus general maintainability cleanup surfaced along the way.

**Scope:** Plan/spec only. No migrations written yet — this doc is the handoff for whoever (human or Opus) writes and runs the actual migrations.

**Non-goals (explicitly out of scope, don't add):** UUID primary keys, ORM introduction, read replicas, sharding. The schema's `BIGSERIAL`/`GENERATED ALWAYS AS IDENTITY` PK strategy and raw `pg` pool setup are correct choices at this scale — no reason to touch either.

---

## Method

Two research passes fed this doc:
1. Full schema inventory (all 56 migration files, `001`–`054` + the `017` collision) — every table's growth profile, FK columns, existing indexes, CHECK constraints, partitioning.
2. Real query access patterns — every `*.repository.ts` in `api/src/modules/`, grepped for WHERE/ORDER BY/pagination/dynamic-SQL shape.

Findings below are cross-referenced against both: an "unindexed FK" only makes Tier 1 if the query-pattern pass also showed it's actually queried that way.

---

## Tier 0 — Client-facing hygiene

Cheap, zero risk, do first. These are things that look bad on a `git grep` or `\d` during the client's DB-access call, not performance issues.

1. ✅ **DONE.** `017` migration numbering collision — renamed `017_docs_rejected.sql` → `055_docs_rejected.sql` (verified `migrate.ts` tracks by filename via `schema_migrations.filename`, and both `017` files use `IF NOT EXISTS`/`ADD VALUE IF NOT EXISTS`, so re-running the renamed file on an environment that already applied it under the old name is a safe no-op).

2. ✅ **DONE.** 25 unreferenced one-line stub files deleted (`config/bullmq.ts`, `config/razorpay.ts`, 3 job processors, `analytics.worker.ts`, `lib/spatial.ts`, 3 notification providers, `notifications/template.service.ts`, `payments.controller.ts`/`.types.ts`, `razorpay.service.ts`, `wallet.service.ts`, `rides.controller.ts`/`.validator.ts`, `broadcast.service.ts`/`.types.ts`, `gps.service.ts`, `otp.service.ts`, `types/api.types.ts`/`db.types.ts`, 3 websocket handlers, `ride.rooms.ts`). Each confirmed zero-reference by grep across `api/src`, `apps/*`, `api/tests`; `tsc --noEmit` clean and test pass/fail counts unchanged before/after (26 pre-existing failures are a missing-env-var issue in the test config loader, unrelated to this cleanup).
   - `payments.repository.ts` — also a 1-line stub, also confirmed zero-reference by two independent greps, but **kept on explicit user decision** (not deleted).

3. **Duplicate rating columns — investigated, not resolved.** `drivers` and `users` each carry both `total_ratings` (from `009_m7_safety.sql`, live — written by `safety.repository.ts`'s rating-aggregate UPDATE, read via `drivers.types.ts` and `apps/driver/src/lib/mock-data.ts`) and `rating_count` (added later by `018_schema_align_users.sql`/`019_schema_align_drivers.sql`). Confirmed by repo-wide grep: `rating_count` is **dead** — appears only in its own migration DDL, never read or written by any app code. **User decision (2026-07-26): leave the column in place for now, don't drop it.** Noting the finding here for whenever it's revisited; `total_ratings` is the column to keep using.

---

## Tier 1 — Scale-blocking (the client's explicit 1M–10M row ask)

### 1.1 Missing FK indexes on `rides` (the central hot-path table)

`rides` is the highest-traffic entity table (every ride lifecycle transition is a write against it) yet 6 of its FK columns have no index:

```sql
CREATE INDEX CONCURRENTLY idx_rides_session_id ON rides (session_id);
CREATE INDEX CONCURRENTLY idx_rides_vehicle_id ON rides (vehicle_id);
CREATE INDEX CONCURRENTLY idx_rides_category_id ON rides (category_id);
CREATE INDEX CONCURRENTLY idx_rides_origin_city_id ON rides (origin_city_id);
CREATE INDEX CONCURRENTLY idx_rides_destination_city_id ON rides (destination_city_id);
CREATE INDEX CONCURRENTLY idx_rides_rental_package_id ON rides (rental_package_id);
```

`category_id` is the most surprising gap — it's used in matching/analytics joins.

### 1.2 Missing indexes on financial reconciliation joins

These back "find all ledger entries for this ride/payment" queries — currently unindexed on tables that are append-only and growing on every completed ride:

```sql
CREATE INDEX CONCURRENTLY idx_driver_wallet_ledger_driver_id ON driver_wallet_ledger (driver_id);
CREATE INDEX CONCURRENTLY idx_driver_earnings_ride_id ON driver_earnings (ride_id);
CREATE INDEX CONCURRENTLY idx_driver_earnings_payment_id ON driver_earnings (payment_id);
CREATE INDEX CONCURRENTLY idx_fare_snapshots_rate_card_id ON fare_snapshots (rate_card_id);
CREATE INDEX CONCURRENTLY idx_fare_snapshots_rental_package_id ON fare_snapshots (rental_package_id);
CREATE INDEX CONCURRENTLY idx_fare_snapshots_surge_event_id ON fare_snapshots (surge_event_id);
CREATE INDEX CONCURRENTLY idx_payments_user_id ON payments (user_id);
CREATE INDEX CONCURRENTLY idx_payments_fare_snapshot_id ON payments (fare_snapshot_id);
```

Also worth a look (lower confidence, smaller tables, include only if migration budget allows): `driver_earnings.settlement_id` already indexed; `tax_deductions.settlement_id` is not — same reconciliation-join shape.

### 1.3 Admin search — `pg_trgm` GIN indexes

`admin.repository.ts`'s four list endpoints (`listDrivers`, `listAdminRides`, `listAdminUsers`, `listAdminPayments`) all filter with `ILIKE '%...%'` (leading wildcard) on `phone`/`full_name`/`code`/`name`/`email`. A leading-wildcard `ILIKE` cannot use a standard btree index — these will sequential-scan `drivers`/`users`/`rides`/`payments`, which are exactly the tables growing fastest. This is the single biggest full-scan risk found in the codebase.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY idx_drivers_search_trgm ON drivers USING gin (phone gin_trgm_ops, full_name gin_trgm_ops, code gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_users_search_trgm ON users USING gin (name gin_trgm_ops, phone gin_trgm_ops);
```

Note: `listAdminUsers`' filter wraps `email` in `COALESCE(u.email,'')` — a trigram index on the raw column won't be used by that expression. Either drop the `COALESCE` (email search on NULL just won't match, which is correct behavior anyway) or build the trigram index on the same expression. Prefer dropping the `COALESCE` — simpler, and searching for a null email was never a meaningful use case.

### 1.4 `gps_tracks` partition horizon — hard failure risk, not just perf

`005_m3_geo.sql`'s `create_gps_partition()` helper is called for "current month + 3" (4 months) at migration time. **There is no recurring job in the migrations that calls it again.** No `DEFAULT` partition exists either. Once the pre-created window is exhausted, GPS inserts will start erroring outright — this is worse than a performance issue, it's an outage.

Fix: a scheduled job (pg_cron if the Postgres install has the extension — confirm on Neon, which does support `pg_cron` as of recent versions; otherwise a BullMQ repeatable job in `api/src/jobs/` calling `create_gps_partition` monthly, 2-3 months ahead of need). This is infra work, not a migration — flag as the top action item, since the current partitions run out **2026-09** per the existing memory note.

### 1.5 Admin list pagination (lower priority — known ceiling, not urgent)

`listDrivers`/`listAdminRides`/`listAdminUsers`/`listAdminPayments` all use OFFSET pagination. Fine at current scale, degrades past roughly 100k rows in the paginated table (Postgres has to walk and discard `OFFSET` rows). Don't fix now — no admin operator is scrolling 100k rows deep today.

```
ponytail: OFFSET pagination on admin list endpoints, degrades past ~100k rows;
migrate to keyset (WHERE created_at < $cursor ORDER BY created_at DESC LIMIT $n)
when admin lists visibly slow down — notification_logs already does this correctly,
copy that pattern.
```

---

## Tier 2 — Maintainability

### 2.1 CHECK constraints on unguarded money columns

Every ledger/wallet table already has `CHECK (amount > 0)`/`CHECK (balance >= 0)` — but several financial tables don't:

```sql
ALTER TABLE payments ADD CONSTRAINT payments_amount_nonneg CHECK (amount >= 0);
ALTER TABLE payments ADD CONSTRAINT payments_commission_amount_nonneg CHECK (commission_amount >= 0);
ALTER TABLE payments ADD CONSTRAINT payments_driver_earning_nonneg CHECK (driver_earning >= 0);
ALTER TABLE settlements ADD CONSTRAINT settlements_gross_earnings_nonneg CHECK (gross_earnings >= 0);
ALTER TABLE settlements ADD CONSTRAINT settlements_net_payout_nonneg CHECK (net_payout >= 0);
ALTER TABLE settlements ADD CONSTRAINT settlements_fee_nonneg CHECK (fee >= 0);
ALTER TABLE fare_snapshots ADD CONSTRAINT fare_snapshots_totals_nonneg
  CHECK (base_fare >= 0 AND distance_fare >= 0 AND time_fare >= 0 AND stop_fare >= 0
         AND total_estimated >= 0 AND total_final >= 0);
ALTER TABLE rate_card_history ADD CONSTRAINT rate_card_history_rates_nonneg
  CHECK (rate_per_km >= 0 AND rate_per_min >= 0 AND min_fare >= 0);
ALTER TABLE driver_wallets ADD CONSTRAINT driver_wallets_lifetime_nonneg
  CHECK (lifetime_topup >= 0 AND lifetime_commission >= 0);
ALTER TABLE tax_deductions ADD CONSTRAINT tax_deductions_amounts_nonneg
  CHECK (taxable_base >= 0 AND tds_amount >= 0);
```

Before applying: check existing rows don't already violate these (dev DB is at ~8500 rows max, should be safe, but verify with a `SELECT count(*) WHERE amount < 0` per column first — a migration that fails on `ALTER TABLE ... ADD CONSTRAINT` because of pre-existing bad data is worse than not adding it).

**Not adding a CHECK on `driver_earnings.amount`** — it's intentionally signed (+/-) for both earnings and deductions, a non-negative check would be wrong.

### 2.2 Flag, don't auto-resolve

- `cities.boundary` (geometry, added `026`) vs `cities.rental_boundary` (geography, `005`) — two parallel boundary representations, each with its own GiST index. Pick one; this is a product/data decision.
- `notification_channel`/`notification_delivery` (used only by `sos_notifications`) vs `notif_channel`/`notif_status` (used by `notification_logs`/`notification_templates`) — two parallel enum families for what's conceptually the same concept. Consolidating means touching the SOS module; scope it separately if pursued.

---

## Migration plan (once approved for execution)

Suggested file split, in this order (each independently safe to run, use `CREATE INDEX CONCURRENTLY` outside a transaction block per Postgres requirement — `migrate.ts` must not wrap these in the default transaction if it does one per file):

```
055_docs_rejected.sql                  — renumber (Tier 0.1)
056_rides_fk_indexes.sql               — Tier 1.1
057_financial_join_indexes.sql         — Tier 1.2
058_admin_search_trgm.sql              — Tier 1.3 (+ pg_trgm extension)
059_money_column_checks.sql            — Tier 2.1
```

Tier 1.4 (partition job) is not a migration — it's a scheduled job to add under `api/src/jobs/`.

---

## Load-testing readiness note (client's item 4)

Once Tier 1 indexes land, load-testing at 1M/2M/5M/10M rows should target: `rides` (active-status sweep queries, user/driver history pagination), `gps_tracks` (partition insert throughput + trail replay), `driver_wallet_ledger`/`driver_earnings` (reconciliation joins), and the 4 admin search endpoints (trigram scan cost at scale — trigram indexes degrade less gracefully than btree past very high cardinality, worth a specific benchmark before telling the client it's solved).

---

## Explicitly not doing (YAGNI)

- UUID PKs — no cross-system ID collision requirement exists; `BIGSERIAL` is simpler and correct here.
- ORM — raw `pg` + typed repositories is already the codebase convention, changing it is unrelated to this ask.
- Read replicas / sharding — premature at 74 tables, ~8500 max rows; revisit if the 10M-row load test shows single-primary Postgres genuinely can't keep up (unlikely at this row count with the indexes above).
