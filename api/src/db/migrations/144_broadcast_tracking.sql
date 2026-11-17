-- Broadcast tracking: every notification a broadcast creates points back at it, so the admin can see what happened to each
-- broadcast (sent, phone push accepted, in-app only, failed, opened) without matching rows by title and time.
-- Expand only (backward compatible): new nullable column, new defaulted columns, one new index. The previous release ignores them.

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS broadcast_id BIGINT REFERENCES notification_broadcasts(id) ON DELETE SET NULL;

ALTER TABLE notification_broadcasts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'done', 'failed')),
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count INT NOT NULL DEFAULT 0,
  -- Matched the audience but left out: switched this type off in the app, or already got the daily limit of broadcasts.
  ADD COLUMN IF NOT EXISTS skipped_opted_out INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_capped INT NOT NULL DEFAULT 0;

-- Broadcasts sent before this migration already ran to completion.
UPDATE notification_broadcasts SET status = 'done', finished_at = created_at, sent_count = recipient_count WHERE status = 'queued';

-- Link the rows those earlier broadcasts created: same owner kind, type, title and body, written within 2 hours of the broadcast.
-- One row per broadcast and person (the lowest id), so the unique index below can never fail on a duplicate.
WITH match AS (
  SELECT DISTINCT ON (b.id, l.owner_id) l.id AS log_id, b.id AS broadcast_id
    FROM notification_broadcasts b
    JOIN notification_logs l
      ON l.channel = 'in_app'
     AND l.owner_type = CASE WHEN b.audience->>'role' = 'driver' THEN 'driver' ELSE 'user' END
     AND l.type = b.category
     AND l.title = b.title
     AND l.body = b.body
     AND l.created_at >= b.created_at
     AND l.created_at < b.created_at + interval '2 hours'
   WHERE l.broadcast_id IS NULL
     -- a row for this person is already linked (a repeat of this migration, or a duplicate row): leave the rest alone
     AND NOT EXISTS (SELECT 1 FROM notification_logs x WHERE x.broadcast_id = b.id AND x.owner_type = l.owner_type AND x.owner_id = l.owner_id)
   ORDER BY b.id, l.owner_id, l.id
)
UPDATE notification_logs l SET broadcast_id = match.broadcast_id FROM match WHERE l.id = match.log_id;

-- One notification per person per broadcast. This is what makes a broadcast run safe to repeat: a second pass after a crash
-- skips everyone already notified. It also serves the per-broadcast statistics (broadcast_id leads the index).
CREATE UNIQUE INDEX IF NOT EXISTS notification_logs_broadcast_owner_uniq
  ON notification_logs (broadcast_id, owner_type, owner_id)
  WHERE broadcast_id IS NOT NULL;
