-- ============================================================
-- Advance booking: admin reserves a driver for a scheduled ride (docs/ADVANCE_BOOKING_PRECLAIM_DESIGN.md).
-- The ride stays 'scheduled' (so the driver is NOT locked out of other rides); ride_advance_meta.claimed_by_driver_id
-- (unused until now) holds the reservation. Reminders and the confirm / ready steps are tracked here, once each.
-- ============================================================
ALTER TABLE ride_advance_meta
  ADD COLUMN claimed_by_admin_id        BIGINT NULL REFERENCES admins(id),
  ADD COLUMN reservation_confirmed_at   TIMESTAMPTZ NULL,
  ADD COLUMN reservation_remind_60_at   TIMESTAMPTZ NULL,
  ADD COLUMN reservation_remind_30_at   TIMESTAMPTZ NULL,
  ADD COLUMN reservation_risk_alerted_at TIMESTAMPTZ NULL;

CREATE INDEX ride_advance_meta_claimed_idx
  ON ride_advance_meta (claimed_by_driver_id)
  WHERE claimed_by_driver_id IS NOT NULL;

-- A driver giving a reservation back is recorded so ops can see who does it late (a warning, not a penalty).
CREATE TABLE driver_reservation_events (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id      BIGINT NOT NULL REFERENCES drivers(id),
  ride_id        BIGINT NOT NULL REFERENCES rides(id),
  event          TEXT NOT NULL CHECK (event IN ('declined', 'released_late', 'dropped_busy', 'no_confirm')),
  minutes_before INTEGER NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX driver_reservation_events_driver_idx ON driver_reservation_events (driver_id, created_at DESC);
