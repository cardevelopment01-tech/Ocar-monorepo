-- Per-driver completed-ride index. Found in the 2026-10-28 stable-ramp test (10M rides): GET /drivers/me and
-- GET /rides/me/earnings-summary hit the 10 s statement timeout (HTTP 500, 123 of 59,198 requests) once the database disk
-- was busy. Both filter on `driver_id = $1 AND status = 'completed'`; rides_driver_idx (driver_id, requested_at) does not
-- cover `status` or `completed_at`, so every call read all of a driver's rides from the table:
--   * /drivers/me:  SELECT COUNT(*) FROM rides WHERE driver_id = $1 AND status = 'completed'  (countCompletedRides)
--                   122k-ride driver: 3.4 s alone on a quiet database, 646 ms mean and 9.9 s max under load
--   * earnings-summary: the same driver filter plus completed_at in a range, joined to payments / fare_snapshots (about 780 ms mean)
-- With this index the count is an index-only scan and the earnings range is an index range scan on (driver_id, completed_at).
--
-- Plain CREATE INDEX (migrate.ts wraps each file in BEGIN/COMMIT, which CONCURRENTLY cannot run inside; same precedent as
-- 057, 100 and 116). It takes a write lock on `rides` while it builds: a second or two at real volume, a minute or two at 10M
-- rides. IF NOT EXISTS makes this a no-op when the index was already built with CREATE INDEX CONCURRENTLY beforehand, which is
-- how it is rolled out on the 10M-ride database (no lock at all).
-- lock_timeout makes the migration fail fast (and the deploy retry) instead of queueing behind a long query.
--
-- ROLLBACK: DROP INDEX IF EXISTS rides_driver_completed_idx;

SET LOCAL lock_timeout = '10s';

CREATE INDEX IF NOT EXISTS rides_driver_completed_idx
  ON rides (driver_id, completed_at)
  WHERE status = 'completed';
