-- rides is the highest-traffic entity table (every ride lifecycle transition
-- writes to it) but 6 of its FK columns had no index. At dev scale this is
-- invisible; at the 1M-10M row scale the client asked about, these become
-- seq-scan joins. Plain CREATE INDEX (not CONCURRENTLY) to match this repo's
-- convention of one transaction per migration file (migrate.ts wraps each
-- file in BEGIN/COMMIT, which CONCURRENTLY cannot run inside) — fine at the
-- current row counts; re-run with CONCURRENTLY by hand if applying to a
-- loaded production table later.

CREATE INDEX idx_rides_session_id ON rides(session_id);
CREATE INDEX idx_rides_vehicle_id ON rides(vehicle_id);
CREATE INDEX idx_rides_category_id ON rides(category_id);
CREATE INDEX idx_rides_origin_city_id ON rides(origin_city_id);
CREATE INDEX idx_rides_destination_city_id ON rides(destination_city_id);
CREATE INDEX idx_rides_rental_package_id ON rides(rental_package_id);
