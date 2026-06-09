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
