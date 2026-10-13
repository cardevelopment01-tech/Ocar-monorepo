-- Push copy for ride lifecycle events that previously reached apps only over the socket
-- (notifyRideEvent in notifications.service.ts). If a row is deactivated the built-in copy is used.
INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema) VALUES
  ('driver_arrived', 'Driver arrived (push, rider)', 'push', 'Your driver has arrived',
   'Your driver is at the pickup point. Share your OTP to start the trip.', '{"required": [], "optional": []}'),
  ('ride_started', 'Trip started (push, rider)', 'push', 'Trip started',
   'Your trip is under way. Have a safe ride.', '{"required": [], "optional": []}'),
  ('ride_cancelled_by_driver', 'Ride cancelled by driver (push, rider)', 'push', 'Ride cancelled',
   'Your driver cancelled the ride. You can book another cab.', '{"required": [], "optional": []}'),
  ('ride_cancelled_by_system', 'Ride auto-cancelled, driver late (push, rider)', 'push', 'Ride cancelled',
   'Your driver didn''t arrive in time, so the ride was cancelled. Please book again.', '{"required": [], "optional": []}'),
  ('ride_no_drivers', 'No drivers found (push, rider)', 'push', 'No drivers found',
   'We could not find a driver nearby. Please try again.', '{"required": [], "optional": []}'),
  ('ride_cancelled_by_rider', 'Ride cancelled by rider (push, driver)', 'push', 'Ride cancelled',
   'The rider cancelled this ride.', '{"required": [], "optional": []}'),
  ('ride_cancelled_timeout', 'Ride auto-cancelled, driver late (push, driver)', 'push', 'Ride cancelled',
   'This ride was cancelled because you did not arrive in time.', '{"required": [], "optional": []}');
