-- Reports/analytics range scans (eng review D8, plan 2026-09-29-reports-page-redesign-plan.md).
-- No usable index existed for `requested_at` or `completed_at` range scans:
--   * rides_active_idx (007) is partial on the four in-flight statuses;
--   * rides_cash_discrepancy_idx (064) is partial on cash_discrepancy = true.
-- Plain CREATE INDEX (not CONCURRENTLY): migrate.ts wraps each file in BEGIN/COMMIT, which
-- CONCURRENTLY cannot run inside (same precedent as 057). Brief write lock on `rides` while
-- it builds; run in a quiet window on a large table.
CREATE INDEX IF NOT EXISTS idx_rides_requested_at
  ON rides (requested_at);

CREATE INDEX IF NOT EXISTS idx_rides_completed_at_completed
  ON rides (completed_at)
  WHERE status = 'completed';
