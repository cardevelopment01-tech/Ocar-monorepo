-- Seed: vehicle lookup data for onboarding dropdowns

INSERT INTO vehicle_categories (slug, display_name, max_passengers) VALUES
  ('hatchback', 'Hatchback', 4),
  ('sedan',     'Sedan',     4),
  ('suv',       'SUV',       6),
  ('luxury',    'Luxury',    4),
  ('van',       'Van',       8)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO vehicle_brands (name) VALUES
  ('Maruti Suzuki'),
  ('Hyundai'),
  ('Tata'),
  ('Honda'),
  ('Toyota'),
  ('Kia'),
  ('MG'),
  ('Mahindra'),
  ('Renault'),
  ('Volkswagen')
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE
  b_maruti    BIGINT;
  b_hyundai   BIGINT;
  b_tata      BIGINT;
  b_honda     BIGINT;
  b_toyota    BIGINT;
  c_hatchback BIGINT;
  c_sedan     BIGINT;
  c_suv       BIGINT;
  c_van       BIGINT;
BEGIN
  SELECT id INTO b_maruti   FROM vehicle_brands WHERE name = 'Maruti Suzuki';
  SELECT id INTO b_hyundai  FROM vehicle_brands WHERE name = 'Hyundai';
  SELECT id INTO b_tata     FROM vehicle_brands WHERE name = 'Tata';
  SELECT id INTO b_honda    FROM vehicle_brands WHERE name = 'Honda';
  SELECT id INTO b_toyota   FROM vehicle_brands WHERE name = 'Toyota';
  SELECT id INTO c_hatchback FROM vehicle_categories WHERE slug = 'hatchback';
  SELECT id INTO c_sedan    FROM vehicle_categories WHERE slug = 'sedan';
  SELECT id INTO c_suv      FROM vehicle_categories WHERE slug = 'suv';
  SELECT id INTO c_van      FROM vehicle_categories WHERE slug = 'van';

  INSERT INTO vehicle_models (brand_id, name, typical_category_id) VALUES
    (b_maruti,  'Swift',         c_hatchback),
    (b_maruti,  'Dzire',         c_sedan),
    (b_maruti,  'Baleno',        c_hatchback),
    (b_hyundai, 'i20',           c_hatchback),
    (b_hyundai, 'Verna',         c_sedan),
    (b_hyundai, 'Creta',         c_suv),
    (b_tata,    'Nexon',         c_suv),
    (b_tata,    'Tigor',         c_sedan),
    (b_honda,   'City',          c_sedan),
    (b_honda,   'Amaze',         c_sedan),
    (b_toyota,  'Innova Crysta', c_van),
    (b_toyota,  'Fortuner',      c_suv)
  ON CONFLICT (brand_id, name) DO NOTHING;
END $$;

-- Cities seed
INSERT INTO cities (
  name, slug, state,
  centroid,
  default_speed_limit_kmph,
  status,
  is_rental_enabled,
  is_return_cab_enabled
) VALUES
  (
    'Bhubaneswar', 'bhubaneswar', 'Odisha',
    ST_GeogFromText('SRID=4326;POINT(85.8245 20.2961)'),
    50, 'active', true, true
  ),
  (
    'Cuttack', 'cuttack', 'Odisha',
    ST_GeogFromText('SRID=4326;POINT(85.8830 20.4686)'),
    50, 'active', false, true
  ),
  (
    'Puri', 'puri', 'Odisha',
    ST_GeogFromText('SRID=4326;POINT(85.8315 19.8135)'),
    40, 'draft', false, false
  )
ON CONFLICT (slug) DO NOTHING;

-- ── Pricing seed ──────────────────────────────────────────────
-- Rate cards: 5 categories × 3 ride types = 15 rows
-- Admin ID 1 = seeded super_admin

INSERT INTO rate_cards
  (category_id, ride_type, rate_per_km, rate_per_min,
   min_fare, return_rate_per_km, hour_rate)
SELECT vc.id, rt.ride_type::ride_type,
  rt.rate_per_km, rt.rate_per_min, rt.min_fare,
  rt.return_rate_per_km, rt.hour_rate
FROM vehicle_categories vc
CROSS JOIN (VALUES
  ('one_way',    10.00::numeric, 1.50::numeric, 200.00::numeric,  8.00::numeric, NULL::numeric),
  ('round_trip', 10.00,          1.50,          200.00,           NULL,          60.00),
  ('rental',      7.00,          0.80,           80.00,           NULL,          NULL)
) AS rt(ride_type, rate_per_km, rate_per_min, min_fare, return_rate_per_km, hour_rate)
WHERE vc.slug = 'hatchback'
ON CONFLICT DO NOTHING;

INSERT INTO rate_cards
  (category_id, ride_type, rate_per_km, rate_per_min,
   min_fare, return_rate_per_km, hour_rate)
SELECT vc.id, rt.ride_type::ride_type,
  rt.rate_per_km, rt.rate_per_min, rt.min_fare,
  rt.return_rate_per_km, rt.hour_rate
FROM vehicle_categories vc
CROSS JOIN (VALUES
  ('one_way',    13.00::numeric, 2.00::numeric, 250.00::numeric, 11.00::numeric, NULL::numeric),
  ('round_trip', 13.00,          2.00,          250.00,          NULL,          100.00),
  ('rental',      9.00,          1.00,          100.00,          NULL,          NULL)
) AS rt(ride_type, rate_per_km, rate_per_min, min_fare, return_rate_per_km, hour_rate)
WHERE vc.slug = 'sedan'
ON CONFLICT DO NOTHING;

INSERT INTO rate_cards
  (category_id, ride_type, rate_per_km, rate_per_min,
   min_fare, return_rate_per_km, hour_rate)
SELECT vc.id, rt.ride_type::ride_type,
  rt.rate_per_km, rt.rate_per_min, rt.min_fare,
  rt.return_rate_per_km, rt.hour_rate
FROM vehicle_categories vc
CROSS JOIN (VALUES
  ('one_way',    17.00::numeric, 2.50::numeric, 350.00::numeric, 14.00::numeric, NULL::numeric),
  ('round_trip', 17.00,          2.50,          350.00,          NULL,          130.00),
  ('rental',     12.00,          1.20,          120.00,          NULL,          NULL)
) AS rt(ride_type, rate_per_km, rate_per_min, min_fare, return_rate_per_km, hour_rate)
WHERE vc.slug = 'suv'
ON CONFLICT DO NOTHING;

INSERT INTO rate_cards
  (category_id, ride_type, rate_per_km, rate_per_min,
   min_fare, return_rate_per_km, hour_rate)
SELECT vc.id, rt.ride_type::ride_type,
  rt.rate_per_km, rt.rate_per_min, rt.min_fare,
  rt.return_rate_per_km, rt.hour_rate
FROM vehicle_categories vc
CROSS JOIN (VALUES
  ('one_way',    25.00::numeric, 4.00::numeric, 500.00::numeric, 20.00::numeric, NULL::numeric),
  ('round_trip', 25.00,          4.00,          500.00,          NULL,          200.00),
  ('rental',     18.00,          1.80,          200.00,          NULL,          NULL)
) AS rt(ride_type, rate_per_km, rate_per_min, min_fare, return_rate_per_km, hour_rate)
WHERE vc.slug = 'luxury'
ON CONFLICT DO NOTHING;

INSERT INTO rate_cards
  (category_id, ride_type, rate_per_km, rate_per_min,
   min_fare, return_rate_per_km, hour_rate)
SELECT vc.id, rt.ride_type::ride_type,
  rt.rate_per_km, rt.rate_per_min, rt.min_fare,
  rt.return_rate_per_km, rt.hour_rate
FROM vehicle_categories vc
CROSS JOIN (VALUES
  ('one_way',    16.00::numeric, 1.80::numeric, 120.00::numeric, 13.00::numeric, NULL::numeric),
  ('round_trip', 16.00,          1.80,          120.00,          NULL,           28.00),
  ('rental',     14.00,          1.50,          150.00,          NULL,           NULL)
) AS rt(ride_type, rate_per_km, rate_per_min, min_fare, return_rate_per_km, hour_rate)
WHERE vc.slug = 'van'
ON CONFLICT DO NOTHING;

-- Stop charges per category
INSERT INTO stop_charges (category_id, charge_per_stop)
SELECT id, CASE slug
  WHEN 'hatchback' THEN 20.00
  WHEN 'sedan'     THEN 25.00
  WHEN 'suv'       THEN 35.00
  WHEN 'luxury'    THEN 50.00
  WHEN 'van'       THEN 40.00
END
FROM vehicle_categories
ON CONFLICT (category_id) DO NOTHING;

-- Hatchback rental packages (6 packages)
INSERT INTO rental_packages
  (category_id, duration_hours, km_limit, package_fare, extra_per_km, extra_per_min)
SELECT vc.id, rp.hours, rp.hours * 10, rp.fare, rp.extra_km, rp.extra_min
FROM vehicle_categories vc
CROSS JOIN (VALUES
  (1::smallint,  100.00::numeric, 10.00::numeric, 1.50::numeric),
  (2,            190.00,          10.00,          1.50),
  (4,            360.00,          10.00,          1.50),
  (6,            520.00,          10.00,          1.50),
  (8,            680.00,          10.00,          1.50),
  (10,           830.00,          10.00,          1.50)
) AS rp(hours, fare, extra_km, extra_min)
WHERE vc.slug = 'hatchback'
ON CONFLICT (category_id, duration_hours) DO NOTHING;

-- Sedan rental packages (6 packages)
INSERT INTO rental_packages
  (category_id, duration_hours, km_limit, package_fare, extra_per_km, extra_per_min)
SELECT vc.id, rp.hours, rp.hours * 10, rp.fare, rp.extra_km, rp.extra_min
FROM vehicle_categories vc
CROSS JOIN (VALUES
  (1::smallint,  150.00::numeric, 10.00::numeric, 1.50::numeric),
  (2,            280.00,          10.00,          1.50),
  (4,            520.00,          10.00,          1.50),
  (6,            750.00,          10.00,          1.50),
  (8,            980.00,          10.00,          1.50),
  (10,          1200.00,          10.00,          1.50)
) AS rp(hours, fare, extra_km, extra_min)
WHERE vc.slug = 'sedan'
ON CONFLICT (category_id, duration_hours) DO NOTHING;

-- ── System config seed ───────────────────────────────────────
INSERT INTO system_config (key, value, value_type, description) VALUES
  ('commission_percent',      '15',   'decimal', 'Platform commission % per ride'),
  ('driver_minimum_balance',  '500',  'integer', 'Min driver wallet balance (INR) to go online'),
  ('cashback_ride_percent',   '5',    'decimal', 'User cashback % per completed ride'),
  ('cashback_expiry_days',    '30',   'integer', 'Days before cashback credits expire'),
  ('referral_referrer_bonus', '100',  'decimal', 'Bonus for referrer on first ride'),
  ('referral_referee_bonus',  '50',   'decimal', 'Bonus for referee on first ride'),
  ('razorpay_enabled',        'false','boolean', 'Enable Razorpay payments (Phase 2)')
ON CONFLICT (key) DO NOTHING;

-- SUV rental packages (6 packages)
INSERT INTO rental_packages
  (category_id, duration_hours, km_limit, package_fare, extra_per_km, extra_per_min)
SELECT vc.id, rp.hours, rp.hours * 10, rp.fare, rp.extra_km, rp.extra_min
FROM vehicle_categories vc
CROSS JOIN (VALUES
  (1::smallint,   200.00::numeric, 10.00::numeric, 1.50::numeric),
  (2,             380.00,          10.00,          1.50),
  (4,             700.00,          10.00,          1.50),
  (6,            1000.00,          10.00,          1.50),
  (8,            1300.00,          10.00,          1.50),
  (10,           1600.00,          10.00,          1.50)
) AS rp(hours, fare, extra_km, extra_min)
WHERE vc.slug = 'suv'
ON CONFLICT (category_id, duration_hours) DO NOTHING;

-- Luxury rental packages (6 packages)
INSERT INTO rental_packages
  (category_id, duration_hours, km_limit, package_fare, extra_per_km, extra_per_min)
SELECT vc.id, rp.hours, rp.hours * 10, rp.fare, rp.extra_km, rp.extra_min
FROM vehicle_categories vc
CROSS JOIN (VALUES
  (1::smallint,   280.00::numeric, 10.00::numeric, 1.50::numeric),
  (2,             540.00,          10.00,          1.50),
  (4,            1000.00,          10.00,          1.50),
  (6,            1450.00,          10.00,          1.50),
  (8,            1900.00,          10.00,          1.50),
  (10,           2350.00,          10.00,          1.50)
) AS rp(hours, fare, extra_km, extra_min)
WHERE vc.slug = 'luxury'
ON CONFLICT (category_id, duration_hours) DO NOTHING;
