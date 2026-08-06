-- Module: ride chat (rider <-> driver in-ride text messaging).
-- One append-only row per message, scoped to a ride_id (same shape family as
-- ride_status_history / dispute_messages). Retained indefinitely -- no purge job.
--
-- Plain table, NOT partitioned. Same call already made for notification_logs in
-- 035_notifications_feed.sql: message volume is bounded by concurrently-active
-- rides, a tiny fraction of the gps_tracks breadcrumb volume that justified
-- partitioning there. CLAUDE.md's pending DB-load-test note lists this table to
-- get its partitioning decision from that one load test alongside
-- ride_status_history, not from bespoke work now.
--
-- client_msg_id (client-generated UUID) is BOTH the retry-dedup key and the
-- idempotency mechanism: insert via ON CONFLICT (...) DO NOTHING RETURNING *,
-- and on no returned row, SELECT the existing row by the same key. No separate
-- dedup table or logic.

CREATE TYPE ride_participant_type AS ENUM ('user', 'driver');

CREATE TABLE ride_messages (
  id             BIGSERIAL PRIMARY KEY,
  ride_id        BIGINT NOT NULL REFERENCES rides(id),
  sender_type    ride_participant_type NOT NULL,
  sender_id      BIGINT NOT NULL,
  body           TEXT NOT NULL,
  client_msg_id  UUID NOT NULL,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ride_messages_dedup_idx
  ON ride_messages (ride_id, sender_type, sender_id, client_msg_id);
CREATE INDEX ride_messages_ride_created_idx
  ON ride_messages (ride_id, created_at);
