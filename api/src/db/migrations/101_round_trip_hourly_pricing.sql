-- Round-trip booked window: same-day (<= 24h) round trips are priced per booked hour
-- (trip_hours x rate_cards.hour_rate) and time past the window is billed as overtime.
--
-- pricing_version marks which formula a ride was quoted under so settlement bills it the
-- same way regardless of when it completes (deploys and rate edits never re-price a ride
-- in flight): 1 = legacy per-day package, 2 = hourly window for bookings up to 24h.
-- Existing rows keep 1 via the default; no backfill.
--   waiting_fare  — the booked-hours charge (pre-surge); kept even on early termination.
--   overtime_min  — billed minutes past booked window + grace; NULL until settled.
--   overtime_fare — overtime charge (unsurged); 0 until settled.

ALTER TABLE fare_snapshots
  ADD COLUMN IF NOT EXISTS pricing_version SMALLINT      NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS waiting_fare    NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_min    INTEGER       NULL,
  ADD COLUMN IF NOT EXISTS overtime_fare   NUMERIC(10,2) NOT NULL DEFAULT 0;

-- NOT VALID then VALIDATE: the constraint guards new rows immediately, and the scan of existing rows (which all
-- hold the defaults) runs under a lock that does not block reads or writes of fare_snapshots.
ALTER TABLE fare_snapshots
  ADD CONSTRAINT fare_snapshots_pricing_version_valid CHECK (pricing_version IN (1, 2)) NOT VALID,
  ADD CONSTRAINT fare_snapshots_waiting_overtime_nonneg
    CHECK (waiting_fare >= 0 AND overtime_fare >= 0 AND (overtime_min IS NULL OR overtime_min >= 0)) NOT VALID;

ALTER TABLE fare_snapshots VALIDATE CONSTRAINT fare_snapshots_pricing_version_valid;
ALTER TABLE fare_snapshots VALIDATE CONSTRAINT fare_snapshots_waiting_overtime_nonneg;
