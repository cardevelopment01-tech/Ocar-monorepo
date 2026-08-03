-- rides_in_progress_idx (029_stuck_ride_review.sql) predates the 'returning'
-- ride_status (added on this branch) and still only covers status='in_progress'
-- rows. findStaleInProgressRides now also queries 'returning' rides, which
-- this index's predicate silently excludes — Postgres falls back to a less
-- efficient plan for those rows. Drop and recreate with the wider predicate.
DROP INDEX IF EXISTS rides_in_progress_idx;

CREATE INDEX rides_in_progress_idx
  ON rides (started_at)
  WHERE status IN ('in_progress', 'returning');
