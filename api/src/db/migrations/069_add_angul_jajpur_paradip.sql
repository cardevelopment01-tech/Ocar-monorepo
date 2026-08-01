-- Client-requested cities: outstation destinations only (no rental boundary yet,
-- matching how Puri shipped — see 016_seed.sql). Status 'active' so they're
-- immediately bookable as one-way/round-trip destinations; rental/return-cab
-- stay off until the client asks to enable local service in these towns.

INSERT INTO cities (
  name, slug, state,
  centroid,
  default_speed_limit_kmph,
  status,
  is_rental_enabled,
  is_return_cab_enabled
) VALUES
  (
    'Angul', 'angul', 'Odisha',
    ST_GeogFromText('SRID=4326;POINT(85.1425 20.8400)'),
    45, 'active', false, false
  ),
  (
    'Jajpur', 'jajpur', 'Odisha',
    ST_GeogFromText('SRID=4326;POINT(86.3333 20.8500)'),
    45, 'active', false, false
  ),
  (
    'Paradip', 'paradip', 'Odisha',
    ST_GeogFromText('SRID=4326;POINT(86.6167 20.3167)'),
    45, 'active', false, false
  )
ON CONFLICT (slug) DO NOTHING;
