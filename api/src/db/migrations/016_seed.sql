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
