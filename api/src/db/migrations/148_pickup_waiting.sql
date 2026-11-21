-- 148_pickup_waiting.sql
-- Waiting charge at the pickup (client bug-list item 37). The clock runs from the driver's arrival at the pickup until the start OTP;
-- the first few minutes are free, then each minute is charged. It applies to every ride type.
--
-- The default (3 free minutes, 3 rupees a minute) lives on the rate card, versioned and city-scoped like stop_charge. A rental
-- package may override either value (NULL = use the rate card), because packages carry their own terms. Both are copied onto the
-- ride's fare_snapshot at booking, so an admin edit never reprices a ride in flight. A snapshot with NULL pinned values (a ride booked
-- before this migration) is never charged for waiting.
--
-- Backward compatible: the previous release never reads these columns and its inserts take the defaults.
SET LOCAL lock_timeout = '10s';

ALTER TABLE rate_cards
  ADD COLUMN IF NOT EXISTS pickup_free_wait_min SMALLINT     NOT NULL DEFAULT 3 CHECK (pickup_free_wait_min >= 0),
  ADD COLUMN IF NOT EXISTS pickup_wait_per_min  NUMERIC(8,2) NOT NULL DEFAULT 3 CHECK (pickup_wait_per_min >= 0);

ALTER TABLE rental_packages
  ADD COLUMN IF NOT EXISTS pickup_free_wait_min SMALLINT     NULL CHECK (pickup_free_wait_min >= 0),
  ADD COLUMN IF NOT EXISTS pickup_wait_per_min  NUMERIC(8,2) NULL CHECK (pickup_wait_per_min >= 0);

ALTER TABLE fare_snapshots
  ADD COLUMN IF NOT EXISTS pickup_free_wait_min SMALLINT     NULL,
  ADD COLUMN IF NOT EXISTS pickup_wait_per_min  NUMERIC(8,2) NULL,
  ADD COLUMN IF NOT EXISTS pickup_wait_min      NUMERIC(8,2) NULL,
  ADD COLUMN IF NOT EXISTS pickup_wait_charge   NUMERIC(8,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN fare_snapshots.pickup_free_wait_min IS 'Free minutes at the pickup, pinned at booking. NULL = booked before waiting charges existed: never charged.';
COMMENT ON COLUMN fare_snapshots.pickup_wait_min IS 'Minutes the driver waited at the pickup (arrival to start OTP), recorded when the trip starts.';
COMMENT ON COLUMN fare_snapshots.pickup_wait_charge IS 'Rupees charged for that wait; added to the final fare at settlement.';
