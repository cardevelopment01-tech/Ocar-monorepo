-- Admin pending_approval queue sorts by MAX(created_at) per driver for to_status='pending_approval';
-- this makes that lookup an index-only scan. driver_status_history only holds status changes (a few rows per
-- driver), so the plain CREATE INDEX is quick; CONCURRENTLY would not run inside the migration transaction.
CREATE INDEX IF NOT EXISTS dsh_driver_to_status_idx ON driver_status_history (driver_id, to_status, created_at DESC);
