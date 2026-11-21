-- One calm push to the rider when the free waiting minutes at the pickup run out and the driver is still waiting. {{rate}} is the
-- per-minute rate the ride was booked with (for example "₹3"), so the copy can never disagree with the billing rule; ops can edit the
-- wording without a release.
INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema) VALUES
  ('pickup_wait_started_rider', 'Free waiting is over (push to rider)', 'push', 'Free waiting is over',
   'Your driver is still waiting at the pickup. {{rate}} a minute now applies.',
   '{"required": ["rate"], "optional": []}');
