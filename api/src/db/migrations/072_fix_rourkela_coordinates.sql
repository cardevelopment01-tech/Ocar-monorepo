-- 070_add_rourkela.sql's INSERT used ON CONFLICT (slug) DO NOTHING, which
-- silently skipped because a 'rourkela' row already existed (added earlier
-- through the admin Cities form) with centroid 0,0 — not a real coordinate,
-- just whatever was left over from an incomplete/placeholder entry.
--
-- Upsert instead of a plain UPDATE so this is correct regardless of whether
-- the bad row still exists or an admin deletes it before this runs — either
-- way the row ends up present with the right coordinates. 070 is already
-- marked as applied in schema_migrations and will never re-run, so this
-- can't rely on that INSERT firing again.

INSERT INTO cities (
  name, slug, state,
  centroid,
  default_speed_limit_kmph,
  status,
  is_rental_enabled,
  is_return_cab_enabled
) VALUES (
  'Rourkela', 'rourkela', 'Odisha',
  ST_GeogFromText('SRID=4326;POINT(84.8536 22.2604)'),
  45, 'active', false, false
)
ON CONFLICT (slug) DO UPDATE
  SET centroid = EXCLUDED.centroid;
