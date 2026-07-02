-- Phase 5.1: City boundary polygons for rental ride enforcement
-- Rough bounding boxes for Odisha cities (refined by admin via spatial tools)

ALTER TABLE cities ADD COLUMN IF NOT EXISTS boundary geometry(Polygon, 4326);

UPDATE cities
SET boundary = ST_GeomFromText(
  'POLYGON((85.75 20.20, 85.92 20.20, 85.92 20.36, 85.75 20.36, 85.75 20.20))',
  4326
)
WHERE slug = 'bhubaneswar';

UPDATE cities
SET boundary = ST_GeomFromText(
  'POLYGON((85.82 20.42, 85.93 20.42, 85.93 20.52, 85.82 20.52, 85.82 20.42))',
  4326
)
WHERE slug = 'cuttack';

UPDATE cities
SET boundary = ST_GeomFromText(
  'POLYGON((85.79 19.77, 85.88 19.77, 85.88 19.85, 85.79 19.85, 85.79 19.77))',
  4326
)
WHERE slug = 'puri';

CREATE INDEX IF NOT EXISTS idx_cities_boundary ON cities USING GIST (boundary);
