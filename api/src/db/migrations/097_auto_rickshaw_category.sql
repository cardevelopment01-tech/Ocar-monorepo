-- Auto rickshaw: new vehicle category, in-city rental-only (no one_way/
-- round_trip rate card — booking those ride types for this category will
-- 422, which is intentional). Fully isolated in the fallback ladder, same
-- as van/luxury (087_remove_luxury_suv_fallback.sql) — no
-- category_fallback_rules rows either direction.
-- See docs/superpowers/specs/2026-09-08-auto-rickshaw-category-design.md

INSERT INTO vehicle_categories (slug, display_name, max_passengers)
VALUES ('auto_rickshaw', 'Auto Rickshaw', 3)
ON CONFLICT (slug) DO NOTHING;

-- rate_cards: rental only. rate_per_km/rate_per_min/min_fare are still
-- required by pricing.service.ts's 422 guard even though the rental
-- branch of calculateFare prices off rental_packages.package_fare, not
-- these columns.
INSERT INTO rate_cards (category_id, ride_type, rate_per_km, rate_per_min, min_fare)
SELECT id, 'rental', 6.00, 0.70, 50.00
FROM vehicle_categories WHERE slug = 'auto_rickshaw'
ON CONFLICT DO NOTHING;

-- stop_charges: one row required per category (006_m4_pricing.sql).
INSERT INTO stop_charges (category_id, charge_per_stop)
SELECT id, 15.00 FROM vehicle_categories WHERE slug = 'auto_rickshaw'
ON CONFLICT (category_id) DO NOTHING;

-- rental_packages: starter tiers. Real pricing is an admin action via the
-- Rental Packages tab (apps/admin/app/(dashboard)/config/rate-cards/RentalPackagesTab.tsx),
-- not a code change.
INSERT INTO rental_packages
  (category_id, duration_minutes, km_limit, package_fare, extra_per_km, extra_per_min, display_order)
SELECT vc.id, rp.duration_minutes, rp.km_limit, rp.package_fare, rp.extra_per_km, rp.extra_per_min, rp.display_order
FROM vehicle_categories vc
CROSS JOIN (VALUES
  (15::smallint, 3,  40.00::numeric, 8.00::numeric, 1.00::numeric, 10::smallint),
  (30,           5,  70.00,          8.00,          1.00,          20),
  (60,          10, 130.00,          8.00,          1.00,          30)
) AS rp(duration_minutes, km_limit, package_fare, extra_per_km, extra_per_min, display_order)
WHERE vc.slug = 'auto_rickshaw'
ON CONFLICT (category_id, duration_minutes, km_limit, COALESCE(city_id, 0)) DO NOTHING;

-- Vehicle brands/models for the driver onboarding dropdown.
-- Full catalog as supplied by the client for the Odisha market (5 manufacturers,
-- 24 models). Model names encode their own fuel variant where relevant (e.g. "RE
-- CNG", "Ape E City", "Alfa DX Duo CNG") — vehicle_models has no fuel_type column
-- of its own; the driver separately selects fuel type at registration time via
-- driver_vehicles.fuel_type (004_m2_vehicles.sql, already generic across every
-- category, no schema change needed here).
INSERT INTO vehicle_brands (name) VALUES
  ('Bajaj'), ('Piaggio'), ('Atul'), ('TVS'), ('Mahindra')
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE
  b_bajaj    BIGINT;
  b_piaggio  BIGINT;
  b_atul     BIGINT;
  b_tvs      BIGINT;
  b_mahindra BIGINT;
  c_auto     BIGINT;
BEGIN
  SELECT id INTO b_bajaj    FROM vehicle_brands WHERE name = 'Bajaj';
  SELECT id INTO b_piaggio  FROM vehicle_brands WHERE name = 'Piaggio';
  SELECT id INTO b_atul     FROM vehicle_brands WHERE name = 'Atul';
  SELECT id INTO b_tvs      FROM vehicle_brands WHERE name = 'TVS';
  SELECT id INTO b_mahindra FROM vehicle_brands WHERE name = 'Mahindra';
  SELECT id INTO c_auto     FROM vehicle_categories WHERE slug = 'auto_rickshaw';

  INSERT INTO vehicle_models (brand_id, name, typical_category_id) VALUES
    (b_bajaj,    'RE',                  c_auto),
    (b_bajaj,    'RE CNG',              c_auto),
    (b_bajaj,    'Compact RE',          c_auto),
    (b_bajaj,    'Gogo',                c_auto),
    (b_bajaj,    'Maxima X Wide',       c_auto),
    (b_bajaj,    'Maxima Z',            c_auto),
    (b_piaggio,  'Classic Diesel',      c_auto),
    (b_piaggio,  'Ape City Plus',       c_auto),
    (b_piaggio,  'Ape E City',          c_auto),
    (b_piaggio,  'Ape E City FX Max',   c_auto),
    (b_piaggio,  'Ape Auto Dx',         c_auto),
    (b_atul,     'Gem Paxx CNG',        c_auto),
    (b_atul,     'Elite Plus Electric', c_auto),
    (b_atul,     'Rik',                 c_auto),
    (b_atul,     'Elite Paxx Electric', c_auto),
    (b_tvs,      'King Deluxe',         c_auto),
    (b_tvs,      'King EV Max',         c_auto),
    (b_tvs,      'King Duramax',        c_auto),
    (b_tvs,      'King Duramax Plus',   c_auto),
    (b_mahindra, 'Treo Plus',           c_auto),
    (b_mahindra, 'Alfa DX Duo CNG',     c_auto),
    (b_mahindra, 'Alfa DX',             c_auto),
    (b_mahindra, 'Udo Electric',        c_auto),
    (b_mahindra, 'E Alfa Plus',         c_auto)
  ON CONFLICT (brand_id, name) DO NOTHING;
END $$;
