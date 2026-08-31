-- Same-day driver eligibility for the live traffic ramp.
--
-- goOnline() (api/src/modules/rides/rides.service.ts) requires a
-- driver_verifications row for TODAY'S IST calendar date — kind
-- 'daily_selfie' AND 'daily_plate', status 'passed' or 'auto_passed' —
-- before ANY driver can go online. That's true for every driver, real or
-- synthetic; nothing about this gate is specific to the load test. Without
-- this, the first call in the ramp fails for all 400 drivers.
--
-- This is NOT a one-time seed. Run it the same calendar day as each live
-- ramp session, shortly before it starts (see LOAD_TEST_PLAN.md §7 — the
-- live session is scheduled after this plan is approved). Safe to re-run
-- any number of times the same day: it mirrors the app's own
-- ON CONFLICT DO NOTHING behavior (insertTodayVerification,
-- driver-verification.repository.ts), so a second run just no-ops.
--
-- Scope: every driver with status='active' and an active primary vehicle —
-- this naturally covers both the ~200 real drivers and the synthetic
-- top-up from seed-load-test-drivers.sql with one query, no phone-prefix
-- filtering needed (a driver ineligible to go online for any other reason
-- isn't helped by this script anyway, so there's no harm in covering
-- everyone active).
--
-- Usage: psql "$DATABASE_URL" -f api/scripts/seed-load-test-daily-verification.sql

\echo 'Granting same-day driver verification (daily_selfie + daily_plate)...'

CREATE TEMP TABLE t_eligible_drivers AS
SELECT d.id AS driver_id, dv.id AS vehicle_id
FROM drivers d
JOIN driver_vehicles dv ON dv.driver_id = d.id AND dv.status = 'active' AND dv.is_primary = true
WHERE d.status = 'active';

INSERT INTO driver_verifications (driver_id, vehicle_id, kind, verified_for, image_url, status)
SELECT driver_id, NULL, 'daily_selfie', (now() AT TIME ZONE 'Asia/Kolkata')::date,
       'https://loadtest.invalid/auto-selfie.jpg', 'auto_passed'
FROM t_eligible_drivers
ON CONFLICT (driver_id, verified_for) WHERE kind = 'daily_selfie' DO NOTHING;

INSERT INTO driver_verifications (driver_id, vehicle_id, kind, verified_for, image_url, status)
SELECT driver_id, vehicle_id, 'daily_plate', (now() AT TIME ZONE 'Asia/Kolkata')::date,
       'https://loadtest.invalid/auto-plate.jpg', 'auto_passed'
FROM t_eligible_drivers
ON CONFLICT (vehicle_id, verified_for) WHERE kind = 'daily_plate' DO NOTHING;

SELECT
  (SELECT count(*) FROM t_eligible_drivers) AS drivers_covered,
  (SELECT count(*) FROM driver_verifications
     WHERE kind = 'daily_selfie' AND verified_for = (now() AT TIME ZONE 'Asia/Kolkata')::date
       AND status = 'auto_passed') AS selfie_rows_today,
  (SELECT count(*) FROM driver_verifications
     WHERE kind = 'daily_plate' AND verified_for = (now() AT TIME ZONE 'Asia/Kolkata')::date
       AND status = 'auto_passed') AS plate_rows_today;

\echo 'Done. All active drivers with an active primary vehicle can now go online today.'
