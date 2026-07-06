-- Non-blocking review flag for rides stuck in_progress (stale driver heartbeat)
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS review_flagged_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS review_reason     TEXT NULL;

CREATE INDEX IF NOT EXISTS rides_in_progress_idx
  ON rides (started_at)
  WHERE status = 'in_progress';
