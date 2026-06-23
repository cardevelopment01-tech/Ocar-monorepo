-- ride_assignments needs a unique constraint on (ride_id, driver_id) so that
-- ON CONFLICT (ride_id, driver_id) DO NOTHING works in createRideAssignment.
ALTER TABLE ride_assignments
  ADD CONSTRAINT ride_assignments_ride_driver_unique UNIQUE (ride_id, driver_id);
