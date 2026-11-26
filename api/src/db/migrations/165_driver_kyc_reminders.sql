-- Driver onboarding reminders (docs/superpowers/specs/2026-11-26-driver-kyc-reminders-design.md).
-- One row per reminder sent. Paused and "how many since progress" are derived from drivers.updated_at, never stored,
-- so this feature never writes to drivers (which would reset the very clock it reads).
CREATE TABLE driver_kyc_reminder_sends (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id       BIGINT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  n               SMALLINT NOT NULL CHECK (n BETWEEN 1 AND 3),
  step            TEXT NOT NULL,
  notification_id BIGINT NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX driver_kyc_reminder_sends_driver_idx ON driver_kyc_reminder_sends (driver_id, sent_at DESC);
-- At most one reminder per driver per India-time day, even if two sweeps overlap.
CREATE UNIQUE INDEX driver_kyc_reminder_sends_one_per_day
  ON driver_kyc_reminder_sends (driver_id, ((sent_at AT TIME ZONE 'Asia/Kolkata')::date));

INSERT INTO system_config (key, value, value_type, description) VALUES
  ('kyc_reminders_enabled', 'false', 'boolean', 'Send onboarding reminders to drivers who stopped partway through verification. Off until switched on.'),
  ('kyc_reminder_day_1',    '1',      'integer', 'Days after a driver''s last progress before the first reminder (1 to 30).'),
  ('kyc_reminder_day_2',    '4',      'integer', 'Days after a driver''s last progress before the second reminder (1 to 30).'),
  ('kyc_reminder_day_3',    '8',      'integer', 'Days after a driver''s last progress before the last reminder (1 to 30).'),
  ('kyc_pause_day',         '10',     'integer', 'Days after a driver''s last progress when the application is paused and reminders stop (1 to 30). Nothing is deleted.')
ON CONFLICT (key) DO NOTHING;

-- Wording is editable in Notification Templates. "_new" is for a driver who verified a number but finished no step.
INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema) VALUES
  ('kyc_reminder_1', 'Onboarding reminder 1 (push)', 'push', '{{headline}}',
   '{{nextAction}} to start getting ride requests. It takes about 5 minutes.',
   '{"required": ["headline", "nextAction"], "optional": []}'),
  ('kyc_reminder_2', 'Onboarding reminder 2 (push)', 'push', 'Your details are saved',
   'Pick up where you left off. {{nextAction}} and our team will review it.',
   '{"required": ["nextAction"], "optional": []}'),
  ('kyc_reminder_3', 'Onboarding reminder 3 (push)', 'push', 'Your application pauses on {{pauseDate}}',
   'Finish before then to keep your place. Your progress stays saved either way.',
   '{"required": ["pauseDate"], "optional": []}'),
  ('kyc_reminder_1_new', 'Onboarding reminder 1, not started (push)', 'push', 'Your application is waiting',
   'Four quick steps and you can start getting ride requests. About 10 minutes.',
   '{"required": [], "optional": []}'),
  ('kyc_reminder_2_new', 'Onboarding reminder 2, not started (push)', 'push', 'Your number is verified',
   'Add your details to continue. Everything you enter is saved as you go.',
   '{"required": [], "optional": []}'),
  ('kyc_reminder_3_new', 'Onboarding reminder 3, not started (push)', 'push', 'Your application pauses on {{pauseDate}}',
   'Start before then to keep your place. Nothing is deleted.',
   '{"required": ["pauseDate"], "optional": []}');
