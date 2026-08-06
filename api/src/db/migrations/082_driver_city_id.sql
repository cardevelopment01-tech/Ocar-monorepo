-- 082_driver_city_id.sql
-- Fixed operating city per driver, so billing_mode (commission vs package)
-- resolves consistently instead of flipping based on live GPS proximity to a
-- city border. NULL = not yet assigned; there is no GPS fallback — an
-- unassigned driver is blocked from going online (see goOnline/acceptRide in
-- rides.service.ts, and the matching-query INNER JOINs in rides.repository.ts).
ALTER TABLE drivers
  ADD COLUMN city_id BIGINT NULL REFERENCES cities(id);

CREATE INDEX drivers_city_id_idx ON drivers (city_id);
