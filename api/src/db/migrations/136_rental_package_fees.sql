-- 136_rental_package_fees.sql
-- City ride work, Phase A (plan: docs/superpowers/plans/2026-11-12-city-ride-separation.md, Task 2).
-- A rental stops depending on its rate_cards row: the stop charge and the cancellation fee live on the rental package and are
-- pinned on the ride's fare_snapshot at booking (like the package terms in migration 099: packages are edited in place, so a
-- later admin edit must not reprice a booked ride). Nothing is removed and no rate card is touched: old API nodes keep working
-- during the blue/green overlap and the code falls back to the rate card for rides that carry no snapshot.
--
-- lock_timeout makes the migration fail fast (and the deploy retry) instead of queueing behind a long ride transaction.
SET LOCAL lock_timeout = '10s';

-- 1. Gaps are reported, never fatal: a data gap must not fail a blue/green deploy. api/scripts/preflight-rental-cards.sql is the
--    gate the owner runs first; a package listed here keeps fees of 0 until an admin sets them.
DO $$
DECLARE gaps text;
BEGIN
  SELECT string_agg(rp.id::text, ', ' ORDER BY rp.id) INTO gaps
  FROM rental_packages rp
  WHERE rp.is_active
    AND NOT EXISTS (
      SELECT 1 FROM rate_cards rc
      WHERE rc.category_id = rp.category_id AND rc.ride_type = 'rental' AND rc.effective_to IS NULL
        AND (rc.city_id = rp.city_id OR rc.city_id IS NULL)
    );
  IF gaps IS NOT NULL THEN
    RAISE WARNING 'rental packages without a current rental rate card (fees stay 0): %', gaps;
  END IF;
END $$;

-- 2. The fees, on the package and on the ride.
ALTER TABLE rental_packages
  ADD COLUMN IF NOT EXISTS stop_charge      NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (stop_charge >= 0),
  ADD COLUMN IF NOT EXISTS cancellation_fee NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (cancellation_fee >= 0);

ALTER TABLE fare_snapshots
  ADD COLUMN IF NOT EXISTS rental_stop_charge      NUMERIC(8,2) NULL,
  ADD COLUMN IF NOT EXISTS rental_cancellation_fee NUMERIC(8,2) NULL;

-- 3. Packages take the values of the rental card in force for them (a city override first, else the global card). Only packages
--    still at the untouched 0 / 0 are filled, so re-running never overwrites an admin edit.
UPDATE rental_packages rp
SET stop_charge      = COALESCE(c.stop_charge, 0),
    cancellation_fee = COALESCE(c.cancellation_fee, 0)
FROM (
  SELECT DISTINCT ON (p.id) p.id AS package_id, rc.stop_charge, rc.cancellation_fee
  FROM rental_packages p
  JOIN rate_cards rc
    ON rc.category_id = p.category_id AND rc.ride_type = 'rental' AND rc.effective_to IS NULL
   AND (rc.city_id = p.city_id OR rc.city_id IS NULL)
  ORDER BY p.id, rc.city_id NULLS LAST
) c
WHERE rp.id = c.package_id
  AND rp.stop_charge = 0 AND rp.cancellation_fee = 0;

-- 4. Rentals still open: pin the fees they would have been charged from the card they were quoted on (the best information we
--    have), as migration 099 did for the package terms. A NULL fee on that card stays NULL and the code falls back to the card.
UPDATE fare_snapshots fs
SET rental_stop_charge      = rc.stop_charge,
    rental_cancellation_fee = rc.cancellation_fee
FROM rides r, rate_cards rc
WHERE r.id = fs.ride_id
  AND rc.id = fs.rate_card_id
  AND r.ride_type = 'rental'
  AND r.status IN ('scheduled', 'requested', 'accepted', 'driver_arrived', 'in_progress', 'returning')
  AND fs.rental_cancellation_fee IS NULL;
