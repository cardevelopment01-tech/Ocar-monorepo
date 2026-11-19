-- Own file so the lock the index build takes is not held together with 145's ALTER TABLE or 146's backfill. The index is partial (only
-- rows that belong to a broadcast), so it is small and quick to build.

-- One notification per person per broadcast. This is what makes a broadcast run safe to repeat: a second pass after a crash
-- skips everyone already notified. It also serves the per-broadcast statistics (broadcast_id leads the index).
CREATE UNIQUE INDEX IF NOT EXISTS notification_logs_broadcast_owner_uniq
  ON notification_logs (broadcast_id, owner_type, owner_id)
  WHERE broadcast_id IS NOT NULL;
