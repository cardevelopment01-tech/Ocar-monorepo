-- 017_city_boundaries.sql's Bhubaneswar box (85.75-85.92 lng, 20.20-20.36 lat) was a
-- rough placeholder that excludes real outskirts of the city — e.g. AIIMS Bhubaneswar
-- (Sijua) sits at roughly (85.706, 20.175), south-west of both edges of that box, so
-- in-city trips there were misclassified as outstation. Widen the box; still a rough
-- rectangle, not a precise municipal boundary — there is no admin tool yet to redraw
-- this as an actual polygon (see 017's own comment: "refined by admin via spatial
-- tools" was aspirational, no such tool was ever built). Treat this as a stopgap.

UPDATE cities
SET boundary = ST_GeomFromText(
  'POLYGON((85.65 20.12, 85.95 20.12, 85.95 20.40, 85.65 20.40, 85.65 20.12))',
  4326
)
WHERE slug = 'bhubaneswar';
