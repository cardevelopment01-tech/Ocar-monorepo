-- Post-load-test DB health audit — READ ONLY, safe to run anytime.
--
-- Run this AFTER the client's synthetic load test (1M–10M rows) to decide,
-- with data instead of guesses, which follow-up optimizations are actually
-- warranted (keyset pagination, ride_status_history partitioning, dropping
-- over-created indexes). Requires pg_stat_statements enabled on Neon for the
-- third query.
--
-- Usage (against the target Neon DB):
--   psql "$DATABASE_URL" -f api/scripts/index-usage-audit.sql
--   (or run each block via any SQL client / the migrate-style pg runner)

-- ── 1. Unused indexes ────────────────────────────────────────────────
-- Zero scans since stats were last reset = dead weight. Validates whether the
-- ~15 indexes added in migrations 057–059 are actually being used. Anything
-- here is a candidate to DROP (saves storage + write amplification). Ignore
-- unique/PK indexes that back constraints even at idx_scan=0.
SELECT s.schemaname,
       s.relname       AS table_name,
       s.indexrelname  AS index_name,
       s.idx_scan      AS scans,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
       i.indisunique   AS is_unique,
       i.indisprimary  AS is_primary
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.schemaname = 'public'
  AND s.idx_scan = 0
ORDER BY pg_relation_size(s.indexrelid) DESC;

-- ── 2. Dead-tuple / bloat pressure ───────────────────────────────────
-- Validates the migration 062 autovacuum tuning. driver_location_snapshots,
-- rides, and driver_sessions should show LOW dead_ratio after the test if the
-- per-table autovacuum settings are working. A high dead_ratio on a hot table
-- means autovacuum isn't keeping up — tighten its threshold further.
SELECT relname                                             AS table_name,
       n_live_tup                                          AS live_rows,
       n_dead_tup                                          AS dead_rows,
       round(n_dead_tup::numeric / NULLIF(n_live_tup, 0), 3) AS dead_ratio,
       last_autovacuum,
       autovacuum_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND n_dead_tup > 0
ORDER BY dead_ratio DESC NULLS LAST;

-- ── 3. Slowest query patterns (needs pg_stat_statements) ──────────────
-- The single most useful signal: which query SHAPES cost the most total time
-- under load. This is what decides #9 (keyset pagination — look for the admin
-- OFFSET list queries here) and any expression/index-defeating patterns that
-- survived. Ranked by cumulative time, not per-call, so frequent-but-cheap and
-- rare-but-expensive both surface correctly.
SELECT queryid,
       calls,
       round(mean_exec_time::numeric, 2)  AS mean_ms,
       round(total_exec_time::numeric, 2) AS total_ms,
       rows,
       left(query, 120)                   AS query_preview
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 30;

-- ── 4. Table + index sizes (storage cost tracking on Neon) ────────────
-- Neon Launch bills storage per GB-month. This shows where the bytes are, so
-- storage growth from the load test (and from any index we added) is visible.
SELECT relname AS table_name,
       pg_size_pretty(pg_total_relation_size(relid))                              AS total_size,
       pg_size_pretty(pg_relation_size(relid))                                    AS heap_size,
       pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid))    AS indexes_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 25;
