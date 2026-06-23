ALTER TABLE ride_assignments
  ADD CONSTRAINT ride_assignments_ride_driver_unique UNIQUE (ride_id, driver_id);
