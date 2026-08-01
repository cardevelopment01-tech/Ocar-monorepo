-- Remaining Odisha towns from apps/driver/src/lib/india-geo.ts's address-picker
-- list that were never actual serviceable cities (no row in `cities`). Same
-- pattern as 069/070: outstation destinations only, no rental boundary.
--
-- Berhampur (Ganjam district) — coastal south Odisha, ~170km SW of Bhubaneswar
-- Sambalpur (Sambalpur district) — western Odisha, ~320km NW of Bhubaneswar
-- Balasore  (Baleswar district) — north coastal Odisha, ~200km NE of Bhubaneswar

INSERT INTO cities (
  name, slug, state,
  centroid,
  default_speed_limit_kmph,
  status,
  is_rental_enabled,
  is_return_cab_enabled
) VALUES
  (
    'Berhampur', 'berhampur', 'Odisha',
    ST_GeogFromText('SRID=4326;POINT(84.7941 19.3149)'),
    45, 'active', false, false
  ),
  (
    'Sambalpur', 'sambalpur', 'Odisha',
    ST_GeogFromText('SRID=4326;POINT(83.9756 21.4669)'),
    45, 'active', false, false
  ),
  (
    'Balasore', 'balasore', 'Odisha',
    ST_GeogFromText('SRID=4326;POINT(86.9317 21.4942)'),
    45, 'active', false, false
  )
ON CONFLICT (slug) DO NOTHING;
