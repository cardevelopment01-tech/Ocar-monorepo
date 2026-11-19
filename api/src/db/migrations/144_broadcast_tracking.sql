-- Broadcast tracking: every notification a broadcast creates points back at it, so the admin can see what happened to each
-- broadcast (sent, phone push accepted, in-app only, failed, opened) without matching rows by title and time.
-- Expand only (backward compatible): new nullable columns and defaulted columns. The previous release ignores them.
-- Kept small on purpose: the linking of earlier rows is 145 and the unique index is 146. The migration runner wraps each file in one
-- transaction, and ALTER TABLE on notification_logs holds a lock until its file commits, so the slow parts must not share this file.

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS broadcast_id BIGINT REFERENCES notification_broadcasts(id) ON DELETE SET NULL;

ALTER TABLE notification_broadcasts
  -- DEFAULT 'done' on purpose: if the previous release has to run against this schema (a deploy overlap or a flip-back) its inserts do
  -- not set a status, and a row that nothing will ever update must not sit at 'queued' forever. This release always inserts 'queued'.
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done'
    CHECK (status IN ('queued', 'sending', 'done', 'failed')),
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count INT NOT NULL DEFAULT 0,
  -- Matched the audience but left out: switched this type off in the app, or already got the daily limit of offers.
  ADD COLUMN IF NOT EXISTS skipped_opted_out INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_capped INT NOT NULL DEFAULT 0,
  -- Left out between the audience check and the send (switched off meanwhile, or the daily limit reached by another broadcast).
  ADD COLUMN IF NOT EXISTS skipped_at_send INT NOT NULL DEFAULT 0,
  -- Optional picture shown in the notification (https URL), and the screen a tap opens (a key from BROADCAST_LINKS in broadcast.service.ts).
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS link TEXT,
  -- Why a broadcast stopped, in words for the admin (e.g. the offer hours passed); null when it did not stop early.
  ADD COLUMN IF NOT EXISTS status_note TEXT;

-- Broadcasts sent before this migration already ran to completion (status 'done' by the default above). A tracked broadcast always has
-- finished_at set, so one with none is a send made by the previous release: the history shows it as "sent before tracking".
UPDATE notification_broadcasts SET finished_at = created_at, sent_count = recipient_count WHERE finished_at IS NULL;
