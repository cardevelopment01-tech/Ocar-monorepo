-- Round-trip booked window reminders (push), one pair per role: 15 minutes before the booked
-- time ends and when it ends. {{graceMin}} comes from ROUND_TRIP_OVERTIME_GRACE_MIN so the copy
-- can never disagree with the billing rule; ops can edit the wording without a release.
INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema) VALUES
  ('trip_window_t15_driver', 'Booked time ending soon (push to driver)', 'push', 'Booked time ending soon',
   '15 min of booked time left.',
   '{"required": [], "optional": []}'),

  ('trip_window_t15_rider', 'Booked time ending soon (push to rider)', 'push', 'Booked time ending soon',
   'Your booked time ends in 15 min.',
   '{"required": [], "optional": []}'),

  ('trip_window_end_driver', 'Booked time ended (push to driver)', 'push', 'Booked time ended',
   'Booked time ended. Extra time starts in {{graceMin}} min.',
   '{"required": ["graceMin"], "optional": []}'),

  ('trip_window_end_rider', 'Booked time ended (push to rider)', 'push', 'Booked time ended',
   'Booked time ended. Extra time starts in {{graceMin}} min.',
   '{"required": ["graceMin"], "optional": []}');
