-- Khorda, Bhubaneswar and Cuttack now share one boundary box, matching how other
-- cab apps treat this cluster as a single metro zone (Khorda town sits just
-- southwest of Bhubaneswar; Cuttack is Bhubaneswar's twin city to the north).
-- classifyTrip() only checks ST_Contains against a single city row's boundary, so
-- widening both Bhubaneswar's and Cuttack's boxes to the same merged rectangle makes
-- a trip between any two points in the cluster resolve to the same city instead of
-- 'outstation'. The rides.service.ts caller now gates its "book an hourly rental instead"
-- block on trip distance (see IN_CITY_MAX_TRIP_DISTANCE_METRES) so a genuine
-- Bhubaneswar<->Cuttack intercity trip, which now also falls inside this box, isn't
-- blocked just because both ends match the same city row.

UPDATE cities
SET boundary = ST_GeomFromText(
  'POLYGON((85.55 20.05, 86.00 20.05, 86.00 20.55, 85.55 20.55, 85.55 20.05))',
  4326
)
WHERE slug IN ('bhubaneswar', 'cuttack');
