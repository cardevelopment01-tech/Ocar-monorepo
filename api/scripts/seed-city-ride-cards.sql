-- Seeds the City ride rate cards (plan: docs/superpowers/plans/2026-11-12-city-ride-separation.md, Task 5 / Gate C).
-- Run ONCE per environment, by the owner, AFTER the API that knows about trip_mode (migration 137) is live on every node and the
-- old blue/green color is drained. Old nodes cannot tell a city card from the intercity one-way card.
--   psql "$DATABASE_URL" -f api/scripts/seed-city-ride-cards.sql
-- Copies every current rental card into a one_way / city card: same rates, fees and city (or global). New rows only, never an
-- UPDATE of a rate card; the rental cards stay open. Safe to re-run: a (category, city) that already has a current city card is skipped.
INSERT INTO rate_cards
  (category_id, ride_type, trip_mode, rate_per_km, rate_per_min, min_fare, base_fare, stop_charge, cancellation_fee, city_id, notes)
SELECT rc.category_id, 'one_way', 'city', rc.rate_per_km, rc.rate_per_min, rc.min_fare, rc.base_fare, rc.stop_charge,
       rc.cancellation_fee, rc.city_id, 'City ride card, copied from the rental card by seed-city-ride-cards.sql'
FROM rate_cards rc
WHERE rc.ride_type = 'rental' AND rc.effective_to IS NULL
  -- A package rental never read these rates, so a placeholder (0 per km, 0 minimum) must not become a free city ride: set such a card
  -- by hand in the admin (City Ride) instead.
  AND rc.rate_per_km > 0 AND rc.min_fare > 0
  AND NOT EXISTS (
    SELECT 1 FROM rate_cards x
    WHERE x.category_id = rc.category_id AND x.ride_type = 'one_way' AND x.trip_mode = 'city'
      AND x.effective_to IS NULL AND COALESCE(x.city_id, 0) = COALESCE(rc.city_id, 0)
  );
