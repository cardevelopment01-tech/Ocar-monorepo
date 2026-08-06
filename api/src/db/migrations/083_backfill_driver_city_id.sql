-- 083_backfill_driver_city_id.sql
-- One-time backfill: resolve city_id for drivers who onboarded before
-- migration 082 added the column, from the city name they already entered
-- at onboarding (drivers.city) — not from GPS. Drivers whose typed city
-- doesn't match any row in `cities` are left NULL (caught at go-online time).
UPDATE drivers
SET city_id = c.id
FROM cities c
WHERE drivers.city_id IS NULL
  AND lower(trim(drivers.city)) = lower(c.name);
