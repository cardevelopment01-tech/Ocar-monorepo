-- ============================================================
-- Flat base fare, sourced from rate cards
-- ------------------------------------------------------------
-- A fixed amount added to every one_way / round_trip fare, before surge, on top of the
-- distance/time meter and the min_fare floor. Versioned and city-scoped like every other rate
-- (new row, effective_to on the old one; see 078, 095, 108).
--
-- 0 = no base fare. NOT NULL DEFAULT 0, so every existing card and ride prices exactly as before
-- until an admin sets a value. Rides settle against the rate card row they were quoted on
-- (fare_snapshots.rate_card_id), so a later edit never reprices a booked ride.
-- ============================================================

ALTER TABLE rate_cards
  ADD COLUMN IF NOT EXISTS base_fare NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (base_fare >= 0);

COMMENT ON COLUMN rate_cards.base_fare IS
  'Flat amount added to every one_way/round_trip fare (before surge). 0 = none. Not applied to rentals (package fare).';

ALTER TABLE rate_card_history
  ADD COLUMN IF NOT EXISTS base_fare NUMERIC(8,2) NULL;
