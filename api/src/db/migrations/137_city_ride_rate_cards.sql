-- 137_city_ride_rate_cards.sql
-- City ride work, Phase B (plan: docs/superpowers/plans/2026-11-12-city-ride-separation.md, Task 5).
-- A city ride keeps ride_type = 'one_way' on the wire (old driver builds handle it correctly) and is told apart from an intercity
-- one-way by trip_mode ('standard' | 'city') on the rate card and on the ride. Nothing reads 'city' until the city_rides_enabled
-- flag (migration 138) is turned on, so this migration changes no behaviour.
--
-- Each migration file runs in one transaction (migrate.ts): the index swap below is atomic, so the one-current-card-per-key
-- guard is never absent. lock_timeout makes the migration fail fast (and the deploy retry) instead of queueing behind a long
-- ride transaction on the hot rides table.
SET LOCAL lock_timeout = '3s';

-- 1. The column. A constant default is a metadata-only change in Postgres 11+: no table rewrite.
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS trip_mode TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE rides      ADD COLUMN IF NOT EXISTS trip_mode TEXT NOT NULL DEFAULT 'standard';

-- 2. The check constraints, added NOT VALID and then validated, so the validating scan holds only a light lock.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rate_cards_trip_mode_check') THEN
    ALTER TABLE rate_cards ADD CONSTRAINT rate_cards_trip_mode_check CHECK (trip_mode IN ('standard', 'city')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rides_trip_mode_check') THEN
    ALTER TABLE rides ADD CONSTRAINT rides_trip_mode_check CHECK (trip_mode IN ('standard', 'city')) NOT VALID;
  END IF;
END $$;
ALTER TABLE rate_cards VALIDATE CONSTRAINT rate_cards_trip_mode_check;
ALTER TABLE rides      VALIDATE CONSTRAINT rides_trip_mode_check;

-- 3. One current card per (city or global, category, ride type, trip mode). Follows migration 078.
DROP INDEX IF EXISTS rate_cards_current_idx;
CREATE UNIQUE INDEX rate_cards_current_idx
  ON rate_cards (COALESCE(city_id, 0), category_id, ride_type, trip_mode)
  WHERE effective_to IS NULL;

DROP INDEX IF EXISTS rate_cards_lookup_idx;
CREATE INDEX rate_cards_lookup_idx
  ON rate_cards (category_id, ride_type, trip_mode, city_id)
  WHERE effective_to IS NULL;

-- 4. City ride cards: a copy of every current rental card (same rates and fees, same city or global), as a one_way / city card.
--    The rental cards stay open (they are closed only in Phase D). Never an UPDATE of a rate card: new rows only.
INSERT INTO rate_cards
  (category_id, ride_type, trip_mode, rate_per_km, rate_per_min, min_fare, base_fare, stop_charge, cancellation_fee, city_id, notes)
SELECT rc.category_id, 'one_way', 'city', rc.rate_per_km, rc.rate_per_min, rc.min_fare, rc.base_fare, rc.stop_charge,
       rc.cancellation_fee, rc.city_id, 'City ride card, copied from the rental card by migration 137'
FROM rate_cards rc
WHERE rc.ride_type = 'rental' AND rc.effective_to IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM rate_cards x
    WHERE x.category_id = rc.category_id AND x.ride_type = 'one_way' AND x.trip_mode = 'city'
      AND x.effective_to IS NULL AND COALESCE(x.city_id, 0) = COALESCE(rc.city_id, 0)
  );
