-- Backfill rental packages for all vehicle categories.
-- Safe to run repeatedly: ON CONFLICT (category_id, duration_hours) DO NOTHING.

DO $$
DECLARE
  pkg RECORD;
BEGIN
  FOR pkg IN
    SELECT slug, hours, fare, extra_km, extra_min FROM (VALUES
      ('hatchback', 1::smallint,  100.00::numeric, 10.00::numeric, 1.50::numeric),
      ('hatchback', 2,            190.00,          10.00,          1.50),
      ('hatchback', 4,            360.00,          10.00,          1.50),
      ('hatchback', 6,            520.00,          10.00,          1.50),
      ('hatchback', 8,            680.00,          10.00,          1.50),
      ('hatchback', 10,           830.00,          10.00,          1.50),
      ('sedan',     1,            150.00,          10.00,          1.50),
      ('sedan',     2,            280.00,          10.00,          1.50),
      ('sedan',     4,            520.00,          10.00,          1.50),
      ('sedan',     6,            750.00,          10.00,          1.50),
      ('sedan',     8,            980.00,          10.00,          1.50),
      ('sedan',     10,          1200.00,          10.00,          1.50),
      ('suv',       1,            200.00,          10.00,          1.50),
      ('suv',       2,            380.00,          10.00,          1.50),
      ('suv',       4,            700.00,          10.00,          1.50),
      ('suv',       6,           1000.00,          10.00,          1.50),
      ('suv',       8,           1300.00,          10.00,          1.50),
      ('suv',       10,          1600.00,          10.00,          1.50),
      ('luxury',    1,            280.00,          10.00,          1.50),
      ('luxury',    2,            540.00,          10.00,          1.50),
      ('luxury',    4,           1000.00,          10.00,          1.50),
      ('luxury',    6,           1450.00,          10.00,          1.50),
      ('luxury',    8,           1900.00,          10.00,          1.50),
      ('luxury',    10,          2350.00,          10.00,          1.50),
      ('van',       1,            240.00,          12.00,          2.00),
      ('van',       2,            460.00,          12.00,          2.00),
      ('van',       4,            850.00,          12.00,          2.00),
      ('van',       6,           1220.00,          12.00,          2.00),
      ('van',       8,           1580.00,          12.00,          2.00),
      ('van',       10,          1940.00,          12.00,          2.00)
    ) AS t(slug, hours, fare, extra_km, extra_min)
  LOOP
    INSERT INTO rental_packages (category_id, duration_hours, km_limit, package_fare, extra_per_km, extra_per_min)
    SELECT vc.id, pkg.hours, pkg.hours * 10, pkg.fare, pkg.extra_km, pkg.extra_min
    FROM vehicle_categories vc WHERE vc.slug = pkg.slug
    ON CONFLICT (category_id, duration_hours) DO NOTHING;
  END LOOP;
END $$;
