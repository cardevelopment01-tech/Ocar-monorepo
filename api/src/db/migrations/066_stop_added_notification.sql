-- Mid-ride add-stop notified the driver over the ride:{rideId} socket room
-- only, so a backgrounded/locked driver app never learned about the new
-- stop. Adds the push template so addRideStop can also route through
-- notifyOwner() (in-app feed + push + socket), matching every other
-- notification call site in the codebase.
INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema) VALUES
  ('stop_added', 'Stop added mid-ride (push to driver)', 'push', 'New stop added',
   'A rider added a stop to your trip{{stopAddress}}.',
   '{"required": [], "optional": ["stopAddress"]}');
