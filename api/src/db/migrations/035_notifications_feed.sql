-- Module M08: in-app notification feed.
-- Supersedes the simple notification_logs table from 013_messaging.sql —
-- that table only ever logged SMS send attempts (job_name/payload/attempt_count)
-- and had no per-owner "has this been seen" state, so bell icons across all
-- three apps had nothing to read from.
--
-- notification_logs is now a per-owner outbox: one row per (owner, event),
-- channel='in_app' rows are what the bell/feed UI reads, other channel rows
-- (sms, push, ...) are delivery-tracking only and never shown in a feed.
--
-- Plain table for now, not partitioned like gps_tracks — notification volume
-- here is a tiny fraction of the GPS breadcrumb volume that justified that.
-- Convert to RANGE PARTITION BY queued_at later (same pattern as
-- create_gps_partition in 005_m3_geo.sql) if volume ever warrants it.

-- notif_channel / notif_status enums already defined in 002_enums.sql

DROP TABLE IF EXISTS notification_logs;

CREATE TABLE notification_logs (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Generic owner pair (matches device_tokens' convention) rather than
  -- separate user_id/driver_id columns — admin-targeted notifications
  -- (driver applications, SOS alerts) need a slot too.
  -- Nullable: pre-auth SMS logs (e.g. login OTP) have a phone number
  -- but no resolvable owner yet.
  owner_type             TEXT NULL CHECK (owner_type IN ('user', 'driver', 'admin')),
  owner_id               BIGINT NULL,
  channel                notif_channel NOT NULL DEFAULT 'in_app',
  status                 notif_status NOT NULL DEFAULT 'queued',
  -- Event type e.g. ride_accepted, ride_completed, sos, driver_submitted_for_review —
  -- drives the feed icon/navigation mapping on the client.
  type                   TEXT NOT NULL,
  title                  TEXT NULL,
  body                   TEXT NOT NULL,
  -- Structured context for deep-linking (e.g. { rideId }) — same role the old
  -- table's `payload` column played for SMS template context.
  payload                JSONB NOT NULL DEFAULT '{}',
  recipient_phone        TEXT NULL,
  recipient_email        TEXT NULL,
  recipient_device_token TEXT NULL,
  ride_id                BIGINT NULL,
  provider               TEXT NULL,
  provider_message_id    TEXT NULL,
  provider_response      JSONB NULL,
  failure_reason         TEXT NULL,
  retry_count            SMALLINT NOT NULL DEFAULT 0,
  next_retry_at          TIMESTAMPTZ NULL,
  queued_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at                TIMESTAMPTZ NULL,
  delivered_at           TIMESTAMPTZ NULL,
  failed_at              TIMESTAMPTZ NULL,
  -- In-app read state — the old design tracks delivery, not "seen in feed".
  read_at                TIMESTAMPTZ NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_logs_in_app_has_owner
    CHECK (channel <> 'in_app' OR (owner_type IS NOT NULL AND owner_id IS NOT NULL))
);

-- Feed listing: "give me this owner's in-app notifications, newest first"
CREATE INDEX idx_notification_logs_owner_feed
  ON notification_logs (owner_type, owner_id, created_at DESC)
  WHERE channel = 'in_app';

-- Unread badge count
CREATE INDEX idx_notification_logs_owner_unread
  ON notification_logs (owner_type, owner_id)
  WHERE channel = 'in_app' AND read_at IS NULL;

CREATE INDEX idx_notification_logs_status
  ON notification_logs (status);
