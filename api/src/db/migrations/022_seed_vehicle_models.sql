-- Seed comprehensive vehicle models for all 10 brands
-- Categories: 1=Hatchback, 2=Sedan, 3=SUV, 4=Luxury, 5=Van
-- Brands: 1=Maruti Suzuki, 2=Hyundai, 3=Tata, 4=Honda, 5=Toyota,
--         6=Kia, 7=MG, 8=Mahindra, 9=Renault, 10=Volkswagen

-- ─── Maruti Suzuki ────────────────────────────────────────────────────────────
INSERT INTO vehicle_models (brand_id, name, typical_category_id) VALUES
  (1, 'Alto K10',   1),
  (1, 'S-Presso',   1),
  (1, 'WagonR',     1),
  (1, 'Celerio',    1),
  (1, 'Swift',      1),
  (1, 'Ignis',      1),
  (1, 'Baleno',     1),
  (1, 'Dzire',      2),
  (1, 'Ciaz',       2),
  (1, 'Ertiga',     5),
  (1, 'XL6',        5),
  (1, 'Brezza',     3),
  (1, 'Grand Vitara', 3)
ON CONFLICT (brand_id, name) DO NOTHING;

-- ─── Hyundai ─────────────────────────────────────────────────────────────────
INSERT INTO vehicle_models (brand_id, name, typical_category_id) VALUES
  (2, 'Grand i10 Nios', 1),
  (2, 'i20',            1),
  (2, 'Aura',           2),
  (2, 'Verna',          2),
  (2, 'Exter',          3),
  (2, 'Venue',          3),
  (2, 'Creta',          3),
  (2, 'Alcazar',        3),
  (2, 'Tucson',         3),
  (2, 'Ioniq 5',        3)
ON CONFLICT (brand_id, name) DO NOTHING;

-- ─── Tata ─────────────────────────────────────────────────────────────────────
INSERT INTO vehicle_models (brand_id, name, typical_category_id) VALUES
  (3, 'Tiago',    1),
  (3, 'Altroz',   1),
  (3, 'Tigor',    2),
  (3, 'Punch',    3),
  (3, 'Nexon',    3),
  (3, 'Harrier',  3),
  (3, 'Safari',   3),
  (3, 'Curvv',    3)
ON CONFLICT (brand_id, name) DO NOTHING;

-- ─── Honda ────────────────────────────────────────────────────────────────────
INSERT INTO vehicle_models (brand_id, name, typical_category_id) VALUES
  (4, 'Amaze',    2),
  (4, 'City',     2),
  (4, 'City e:HEV', 2),
  (4, 'Elevate',  3),
  (4, 'WR-V',     3)
ON CONFLICT (brand_id, name) DO NOTHING;

-- ─── Toyota ──────────────────────────────────────────────────────────────────
INSERT INTO vehicle_models (brand_id, name, typical_category_id) VALUES
  (5, 'Glanza',        1),
  (5, 'Rumion',        5),
  (5, 'Camry',         4),
  (5, 'Urban Cruiser Hyryder', 3),
  (5, 'Innova Crysta', 5),
  (5, 'Innova HyCross', 5),
  (5, 'Fortuner',      3),
  (5, 'Vellfire',      4)
ON CONFLICT (brand_id, name) DO NOTHING;

-- ─── Kia ─────────────────────────────────────────────────────────────────────
INSERT INTO vehicle_models (brand_id, name, typical_category_id) VALUES
  (6, 'Sonet',   3),
  (6, 'Seltos',  3),
  (6, 'Carens',  5),
  (6, 'EV6',     3)
ON CONFLICT (brand_id, name) DO NOTHING;

-- ─── MG ──────────────────────────────────────────────────────────────────────
INSERT INTO vehicle_models (brand_id, name, typical_category_id) VALUES
  (7, 'Hector',       3),
  (7, 'Hector Plus',  3),
  (7, 'Astor',        3),
  (7, 'Gloster',      3),
  (7, 'ZS EV',        3),
  (7, 'Comet EV',     1)
ON CONFLICT (brand_id, name) DO NOTHING;

-- ─── Mahindra ────────────────────────────────────────────────────────────────
INSERT INTO vehicle_models (brand_id, name, typical_category_id) VALUES
  (8, 'Bolero',      3),
  (8, 'Bolero Neo',  3),
  (8, 'Scorpio',     3),
  (8, 'Scorpio N',   3),
  (8, 'XUV300',      3),
  (8, 'XUV400 EV',   3),
  (8, 'XUV700',      3),
  (8, 'Thar',        3),
  (8, 'BE 6',        3)
ON CONFLICT (brand_id, name) DO NOTHING;

-- ─── Renault ─────────────────────────────────────────────────────────────────
INSERT INTO vehicle_models (brand_id, name, typical_category_id) VALUES
  (9, 'Kwid',   1),
  (9, 'Triber', 5),
  (9, 'Kiger',  3),
  (9, 'Duster', 3)
ON CONFLICT (brand_id, name) DO NOTHING;

-- ─── Volkswagen ──────────────────────────────────────────────────────────────
INSERT INTO vehicle_models (brand_id, name, typical_category_id) VALUES
  (10, 'Polo',   1),
  (10, 'Vento',  2),
  (10, 'Virtus', 2),
  (10, 'Taigun', 3),
  (10, 'Tiguan', 3)
ON CONFLICT (brand_id, name) DO NOTHING;
