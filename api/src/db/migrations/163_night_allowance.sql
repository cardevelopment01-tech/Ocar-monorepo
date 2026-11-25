-- 163_night_allowance.sql
-- Night allowance (client request): a flat amount added to the rider's fare for every night a one-way or round trip is driven between
-- 11 PM and 6 AM (IST), paid on to the driver like the airport toll. Return Cab rides are one-way bookings, so they are covered by the same
-- rule; city rides and rentals are not charged.
--
-- The amount lives on the rate card (versioned and city-scoped like every other rate; 0 = off, which is every existing card). A ride is
-- billed on the rate card it was quoted on (fare_snapshots.rate_card_id), so an admin edit never reprices a ride in flight, and every ride
-- booked before this migration is on a card whose amount is 0.
--
-- Charged at settlement from the trip's real start and end times, not estimated at booking (the airport toll works the same way).
--
-- Backward compatible: the previous release never reads these columns and its inserts take the defaults.
SET LOCAL lock_timeout = '10s';

ALTER TABLE rate_cards
  ADD COLUMN IF NOT EXISTS night_allowance_per_night NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (night_allowance_per_night >= 0);

ALTER TABLE fare_snapshots
  ADD COLUMN IF NOT EXISTS night_allowance NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS night_count     SMALLINT     NOT NULL DEFAULT 0;

COMMENT ON COLUMN rate_cards.night_allowance_per_night IS 'Rupees per night the trip is driven between 11 PM and 6 AM IST. one_way and round_trip (standard mode) only; 0 = no night allowance.';
COMMENT ON COLUMN fare_snapshots.night_allowance IS 'Rupees of night allowance charged, recorded at settlement; added to the final fare and paid on to the driver.';
COMMENT ON COLUMN fare_snapshots.night_count IS 'How many nights the allowance was charged for (night_allowance = night_count x the rate card amount).';
