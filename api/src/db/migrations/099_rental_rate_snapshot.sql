-- Snapshot the rental package terms on the ride's fare_snapshot at booking time.
-- rental_packages rows are edited in place by admins (not versioned like rate_cards),
-- so without this, trip-end overage billing would use whatever the rates are at
-- COMPLETION — an admin edit between booking and completion would silently change
-- what an in-flight rider is charged. Settlement reads these columns and only falls
-- back to the live package for rides booked before this migration.

ALTER TABLE fare_snapshots
  ADD COLUMN IF NOT EXISTS rental_km_limit         NUMERIC(8,2) NULL,
  ADD COLUMN IF NOT EXISTS rental_duration_minutes INTEGER      NULL,
  ADD COLUMN IF NOT EXISTS rental_extra_per_km     NUMERIC(8,2) NULL,
  ADD COLUMN IF NOT EXISTS rental_extra_per_min    NUMERIC(8,2) NULL;

-- Open rentals: pin them to the terms as they stand now (the best information we have).
UPDATE fare_snapshots fs
SET rental_km_limit         = rp.km_limit,
    rental_duration_minutes = rp.duration_minutes,
    rental_extra_per_km     = rp.extra_per_km,
    rental_extra_per_min    = rp.extra_per_min
FROM rental_packages rp
WHERE fs.rental_package_id = rp.id
  AND fs.status = 'estimate'
  AND fs.rental_km_limit IS NULL;
