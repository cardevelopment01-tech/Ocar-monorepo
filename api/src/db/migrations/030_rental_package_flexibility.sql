-- Decouple rental package km_limit from duration and allow sub-hour durations.
-- Previously: duration_hours IN (1,2,4,6,8,10) and km_limit forced to duration_hours * 10.
-- That made it impossible to add packages like 30min/10km or 1hr/20km, or to
-- change an existing package's km_limit independent of its duration.

-- Drop every existing CHECK/UNIQUE constraint on the table by actual name rather than
-- guessing — the km_limit = duration_hours * 10 check references two columns, so
-- Postgres names it the generic "rental_packages_check", not "rental_packages_km_limit_check".
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'rental_packages'::regclass AND contype IN ('c', 'u')
  LOOP
    EXECUTE format('ALTER TABLE rental_packages DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE rental_packages
  RENAME COLUMN duration_hours TO duration_minutes;

UPDATE rental_packages SET duration_minutes = duration_minutes * 60;

ALTER TABLE rental_packages
  ADD CONSTRAINT rental_packages_duration_minutes_check CHECK (duration_minutes > 0),
  ADD CONSTRAINT rental_packages_km_limit_check CHECK (km_limit > 0),
  ADD CONSTRAINT rental_packages_category_duration_km_key UNIQUE (category_id, duration_minutes, km_limit),
  ADD COLUMN IF NOT EXISTS display_order SMALLINT NOT NULL DEFAULT 100;

-- Client request: convert the existing 2hr package from 20km to 30km limit (same fare).
UPDATE rental_packages SET km_limit = 30 WHERE duration_minutes = 120;
