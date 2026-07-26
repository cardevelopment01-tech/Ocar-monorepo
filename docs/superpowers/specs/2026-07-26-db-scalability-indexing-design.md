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

`rides` is the highest-traffic entity table (every ride lifecycle transition is a write against it) yet 6 of its FK columns have no index.

✅ **DONE** — `056_rides_fk_indexes.sql`. Uses plain `CREATE INDEX` (not `CONCURRENTLY`): `migrate.ts` wraps each migration file in one `BEGIN`/`COMMIT` transaction, and `CONCURRENTLY` cannot run inside a transaction block — matches the existing convention in this codebase's migrations. Fine at current row counts (~8500 max); re-run with `CONCURRENTLY` by hand outside `migrate.ts` if ever applying to a live, loaded production table.

`category_id` is the most surprising gap — it's used in matching/analytics joins.

### 1.2 Missing indexes on financial reconciliation joins

These back "find all ledger entries for this ride/payment" queries — currently unindexed on tables that are append-only and growing on every completed ride.

✅ **DONE** — `057_financial_join_indexes.sql`. Also added `tax_deductions.settlement_id` (same reconciliation-join shape as `driver_earnings.settlement_id`, which already had an index).

### 1.3 Admin search — `pg_trgm` GIN indexes

`admin.repository.ts`'s four list endpoints (`listDrivers`, `listAdminRides`, `listAdminUsers`, `listAdminPayments`) all filter with `ILIKE '%...%'` (leading wildcard) on `phone`/`full_name`/`code`/`name`/`email`. A leading-wildcard `ILIKE` cannot use a standard btree index — these will sequential-scan `drivers`/`users`/`rides`/`payments`, which are exactly the tables growing fastest. This is the single biggest full-scan risk found in the codebase.

✅ **DONE** — `058_admin_search_trgm.sql` (one GIN index per searched column, rather than one combined multi-column index, so each column's trigram index is usable independently since the queries OR across columns rather than ANDing them).

Also fixed: `listAdminUsers`' filter wrapped `email` in `COALESCE(u.email,'')`, which would have defeated the new trigram index (an expression index would be needed to match it). Dropped the `COALESCE` in `admin.repository.ts` — a null email simply won't match a search term either way, so behavior is unchanged, and the raw-column trigram index now applies.

### 1.4 `gps_tracks` partition horizon — ✅ ALREADY FIXED

`005_m3_geo.sql`'s `create_gps_partition()` helper only pre-creates 4 months of partitions at migration time, with no recurring caller — this was flagged as an outage risk (inserts fail once the window runs out).

**Re-verified 2026-07-26: this is already resolved.** `api/src/jobs/processors/partition-creator.processor.ts` calls `create_gps_partition()` for next month, run via `api/src/jobs/workers/partition-maintenance.worker.ts` on a BullMQ repeatable schedule wired in `server.ts` (`create_next_partition` + `purge_old_partitions`, both on the `PARTITION_MAINTENANCE` queue). The processor's own comment confirms it was written specifically to fix this audit finding. No action needed — the original memory note (partitions run out 2026-09) predates this fix.

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

### 2.1 CHECK constraints on unguarded money columns — ✅ DONE

Every ledger/wallet table already has `CHECK (amount > 0)`/`CHECK (balance >= 0)` — but several financial tables didn't:

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

Applied as `059_money_column_checks.sql`. Verified against the live Neon dev DB before writing it (zero rows violate any of these constraints), then ran `pnpm migrate` against Neon to confirm all of 055-059 apply cleanly — they do.

**Not adding a CHECK on `driver_earnings.amount`** — it's intentionally signed (+/-) for both earnings and deductions, a non-negative check would be wrong.

### 2.2 Flag, don't auto-resolve

- `cities.boundary` (geometry, added `026`) vs `cities.rental_boundary` (geography, `005`) — two parallel boundary representations, each with its own GiST index. Pick one; this is a product/data decision.
- `notification_channel`/`notification_delivery` (used only by `sos_notifications`) vs `notif_channel`/`notif_status` (used by `notification_logs`/`notification_templates`) — two parallel enum families for what's conceptually the same concept. Consolidating means touching the SOS module; scope it separately if pursued.

---

## Migration plan — ✅ ALL APPLIED (2026-07-26)

```
055_docs_rejected.sql                  — renumber (Tier 0.1)                     ran
056_rides_fk_indexes.sql               — Tier 1.1                               ran
057_financial_join_indexes.sql         — Tier 1.2                               ran
058_admin_search_trgm.sql              — Tier 1.3 (+ pg_trgm extension)         ran
059_money_column_checks.sql            — Tier 2.1                               ran
```

All 5 use plain `CREATE INDEX`/`ALTER TABLE` (not `CONCURRENTLY`), matching this codebase's one-transaction-per-migration-file convention in `migrate.ts` — fine at current row counts. Verified by running `pnpm migrate` against the live Neon dev DB: all applied without error.

Tier 1.4 (gps_tracks partition job) turned out to already be implemented (`api/src/jobs/processors/partition-creator.processor.ts` + `partition-maintenance.worker.ts`, scheduled in `server.ts`) — no new code needed.

Remaining open items (not resolved by this pass, by design): Tier 0.3 (drop dead `rating_count` column — user decision was to leave it for now) and Tier 2.2 (duplicate `cities` boundary columns, duplicate notification enum families — flagged for a product decision, not touched).

---

## Load-testing readiness note (client's item 4)

Once Tier 1 indexes land, load-testing at 1M/2M/5M/10M rows should target: `rides` (active-status sweep queries, user/driver history pagination), `gps_tracks` (partition insert throughput + trail replay), `driver_wallet_ledger`/`driver_earnings` (reconciliation joins), and the 4 admin search endpoints (trigram scan cost at scale — trigram indexes degrade less gracefully than btree past very high cardinality, worth a specific benchmark before telling the client it's solved).

---

## Explicitly not doing (YAGNI)

- UUID PKs — no cross-system ID collision requirement exists; `BIGSERIAL` is simpler and correct here.
- ORM — raw `pg` + typed repositories is already the codebase convention, changing it is unrelated to this ask.
- Read replicas / sharding — premature at 74 tables, ~8500 max rows; revisit if the 10M-row load test shows single-primary Postgres genuinely can't keep up (unlikely at this row count with the indexes above).
