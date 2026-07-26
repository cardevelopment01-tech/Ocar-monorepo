-- driver_location_snapshots: 1 row/driver, upserted ~every 30s. The GiST index on
-- location makes every update non-HOT -> relentless dead tuples. fillfactor can't
-- help (indexed column changes); aggressive autovacuum is the only lever. Table is
-- TINY (row count = driver count) so constant vacuuming is cheap on Neon compute.
ALTER TABLE driver_location_snapshots SET (
  autovacuum_vacuum_scale_factor = 0.0,
  autovacuum_vacuum_threshold    = 50,
  autovacuum_vacuum_cost_delay   = 0
);

-- rides / driver_sessions: frequent status UPDATEs. fillfactor leaves in-page room
-- so updates touching only non-indexed columns stay HOT (no index churn). Affects
-- FUTURE row rewrites only; existing rows benefit after natural churn. Do NOT run
-- VACUUM FULL here (exclusive lock) — let pages rewrite naturally.
ALTER TABLE rides           SET (fillfactor = 85, autovacuum_vacuum_scale_factor = 0.02);
ALTER TABLE driver_sessions SET (fillfactor = 85, autovacuum_vacuum_scale_factor = 0.05);
