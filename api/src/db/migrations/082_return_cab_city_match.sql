-- 082_return_cab_city_match.sql
-- Return-cab matching now uses the driver's DESTINATION CITY IDENTITY for the
-- drop-off check (any drop-off whose nearest active city is this city matches),
-- instead of a fixed radius around the city centroid point. A real address a
-- few km from a city's centroid dot is still "in that city" and must match.
--
-- destination_city_id: the city the driver chose at go-online. Nullable: only
-- new go-online rows populate it. Existing active rows (drivers currently online
-- in return mode) stay NULL and simply stop matching until their next go-online
-- — return-cab sessions are ephemeral (re-created every time a driver goes
-- online), so no backfill is warranted.
ALTER TABLE return_cab_routes
  ADD COLUMN destination_city_id BIGINT NULL REFERENCES cities(id);

-- match_radius_metres is now PICKUP-ONLY ("is the rider near where I'm starting
-- my return trip"). Client-confirmed value is 3km. Drop-off no longer uses it.
ALTER TABLE return_cab_routes
  ALTER COLUMN match_radius_metres SET DEFAULT 3000;

UPDATE return_cab_routes
  SET match_radius_metres = 3000
  WHERE match_radius_metres = 2000 AND is_active = true;
