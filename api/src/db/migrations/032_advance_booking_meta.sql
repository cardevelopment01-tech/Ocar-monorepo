-- ============================================================
-- M07 EXT: ADVANCE BOOKING (part 2 — table + index)
-- Must run after 031_advance_booking.sql commits the new enum values.
-- See docs/ADVANCE_BOOKING_PLAN.md.
-- ============================================================

-- ── RIDE ADVANCE META ─────────────────────────────────────────
-- One row per scheduled ride. Kept off the hot `rides` table —
-- mirrors the existing ride_cancellations / ride_status_history side-table pattern.
CREATE TABLE ride_advance_meta (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id                 BIGINT NOT NULL UNIQUE REFERENCES rides(id),
  status                  advance_booking_status NOT NULL DEFAULT 'pending_driver',
  dispatch_buffer_minutes SMALLINT NOT NULL DEFAULT 15,
  dispatch_job_id         TEXT NULL,
  -- Phase 2 only (driver pre-claim) — not populated by phase 1
  claimed_by_driver_id    BIGINT NULL REFERENCES drivers(id),
  claimed_at              TIMESTAMPTZ NULL,
  reminder_24h_sent_at    TIMESTAMPTZ NULL,
  reminder_1h_sent_at     TIMESTAMPTZ NULL,
  -- Analytics/dispute reference only — never used to compute the charged fare
  rate_card_id_at_booking BIGINT NULL REFERENCES rate_cards(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ride_advance_meta_pending_idx
  ON ride_advance_meta (status)
  WHERE status IN ('pending_driver', 'driver_confirmed');

CREATE TRIGGER trg_ride_advance_meta_updated_at
  BEFORE UPDATE ON ride_advance_meta
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── FIX rides_scheduled_idx ───────────────────────────────────
-- Original predicate (007_m5_booking.sql) filtered status = 'requested', which a
-- scheduled ride never holds while waiting. Repoint at the new 'scheduled' status.
DROP INDEX IF EXISTS rides_scheduled_idx;
CREATE INDEX rides_scheduled_idx
  ON rides (scheduled_for)
  WHERE scheduled_for IS NOT NULL AND status = 'scheduled';
