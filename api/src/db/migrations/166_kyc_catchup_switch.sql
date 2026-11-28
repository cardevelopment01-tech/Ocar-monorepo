-- Onboarding reminders for drivers who stalled so long ago that they were past the pause day before any reminder reached them
-- (reminders were switched on later). Off until switched on: the same three reminders, counted from the first one.
INSERT INTO system_config (key, value, value_type, description) VALUES
  ('kyc_catchup_enabled', 'false', 'boolean', 'Also remind drivers who stopped partway through verification before reminders started: they get the same three reminders, counted from the first. Off until switched on.')
ON CONFLICT (key) DO NOTHING;
