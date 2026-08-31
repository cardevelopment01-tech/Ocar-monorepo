-- 083_backfill_city_boundaries.sql overwrote Bhubaneswar's and Cuttack's boundary
-- with tight real-world municipal-corporation polygons, unintentionally undoing
-- 055_merge_khorda_bbsr_ctc_boundary.sql's deliberate wide merged box. That box
-- existed specifically so Khordha town (which sits outside Bhubaneswar's civic
-- limits but is served as part of the same metro) classifies as in-city rather
-- than outstation via classifyTrip()'s ST_Contains check.
--
-- Net effect of the regression: any Khordha <-> Bhubaneswar trip started
-- classifying as 'outstation' again, since Khordha isn't its own seeded city
-- row and now falls outside every city's boundary.
--
-- Restore 055's merged box for Bhubaneswar/Cuttack only. Puri, Jajpur, and the
-- rest of 083's real-boundary backfill are untouched and correct as-is.
UPDATE cities
SET boundary = ST_GeomFromText(
  'POLYGON((85.55 20.05, 86.00 20.05, 86.00 20.55, 85.55 20.55, 85.55 20.05))',
  4326
)
WHERE slug IN ('bhubaneswar', 'cuttack');
