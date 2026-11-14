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

-- 2. The check constraint, on the small rate_cards table only. rides gets none: validating one would scan the whole table while the
--    ADD COLUMN lock is still held (one transaction), and createRide only ever writes 'standard' or 'city' (parseTripMode).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rate_cards_trip_mode_check') THEN
    ALTER TABLE rate_cards ADD CONSTRAINT rate_cards_trip_mode_check CHECK (trip_mode IN ('standard', 'city')) NOT VALID;
  END IF;
END $$;
ALTER TABLE rate_cards VALIDATE CONSTRAINT rate_cards_trip_mode_check;

-- 3. One current card per (city or global, category, ride type, trip mode). Follows migration 078.
DROP INDEX IF EXISTS rate_cards_current_idx;
CREATE UNIQUE INDEX rate_cards_current_idx
  ON rate_cards (COALESCE(city_id, 0), category_id, ride_type, trip_mode)
  WHERE effective_to IS NULL;

DROP INDEX IF EXISTS rate_cards_lookup_idx;
CREATE INDEX rate_cards_lookup_idx
  ON rate_cards (category_id, ride_type, trip_mode, city_id)
  WHERE effective_to IS NULL;

-- City ride cards are NOT created here. Migrations run before the cutover, so old API nodes keep serving against this data; they do
-- not filter on trip_mode and would quote an intercity one-way on a city card (or close it on an admin edit). The cards are copied
-- from the rental cards by api/scripts/seed-city-ride-cards.sql, which the owner runs once the new API is live on every node.
