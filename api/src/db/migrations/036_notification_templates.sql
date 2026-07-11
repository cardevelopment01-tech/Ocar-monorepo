-- Module M08: notification_templates — channel-specific message templates
-- with {{variable}} substitution, referenced by the notifications worker
-- instead of hardcoded strings in TypeScript.

CREATE TABLE notification_templates (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug             VARCHAR(80) NOT NULL,
  name             VARCHAR(120) NOT NULL,
  channel          notif_channel NOT NULL,
  locale           VARCHAR(10) NOT NULL DEFAULT 'en',
  subject          TEXT NULL,
  body             TEXT NOT NULL,
  -- {"required": ["otp"], "optional": []} — validated against the render
  -- call's context before substitution, so a missing variable is a caught
  -- validation error rather than a mangled message reaching a real user.
  variables_schema JSONB NOT NULL DEFAULT '{"required": [], "optional": []}',
  is_active        BOOLEAN NOT NULL DEFAULT true,
  version          SMALLINT NOT NULL DEFAULT 1,
  created_by       BIGINT NULL REFERENCES admins(id),
  updated_by       BIGINT NULL REFERENCES admins(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "give me the active template for this slug+channel+locale" — the render lookup
CREATE UNIQUE INDEX idx_notification_templates_lookup
  ON notification_templates (slug, channel, locale)
  WHERE is_active;

CREATE INDEX idx_notification_templates_channel
  ON notification_templates (channel, slug)
  WHERE is_active;

CREATE TRIGGER notification_templates_updated_at
  BEFORE UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed with the exact copy notifications.worker.ts currently hardcodes, so
-- rewiring it onto renderTemplate() is a behavior-preserving refactor.
INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema) VALUES
  ('driver_submitted_for_review', 'Driver application submitted (SMS to admin)', 'sms', NULL,
   'Ocar: New driver application received. Driver: {{driverName}} ({{driverPhone}}). Submitted at {{submittedAt}}. Log in to admin panel to review.',
   '{"required": ["driverName", "driverPhone", "submittedAt"], "optional": []}'),

  ('driver_submitted_for_review', 'Driver application submitted (push to admin)', 'push', 'New Driver Application',
   '{{driverName}} submitted an application for review.',
   '{"required": ["driverName"], "optional": []}'),

  ('otp_auth', 'Login OTP (SMS)', 'sms', NULL,
   'Your Ocar login OTP is {{otp}}. Valid for 10 minutes. Do not share with anyone.',
   '{"required": ["otp"], "optional": []}'),

  ('otp_trip_start', 'Trip start OTP (SMS)', 'sms', NULL,
   'Your Ocar trip OTP is {{otp}}. Share this with your driver to start the ride.',
   '{"required": ["otp"], "optional": []}'),

  ('otp_trip_end', 'Trip end OTP (SMS)', 'sms', NULL,
   'Your Ocar trip OTP is {{otp}}. Share this with your driver to complete the ride.',
   '{"required": ["otp"], "optional": []}'),

  ('sos_alert', 'SOS alert (SMS to admin)', 'sms', NULL,
   'OCAR SOS ALERT: Passenger {{userPhone}} triggered an SOS during ride #{{rideId}}. Location: {{lat}},{{lng}}. Time: {{triggeredAt}}. Take immediate action.',
   '{"required": ["userPhone", "rideId", "lat", "lng", "triggeredAt"], "optional": []}'),

  ('sos_alert', 'SOS alert (push to admin)', 'push', 'SOS ALERT',
   'Passenger triggered SOS during ride #{{rideId}}',
   '{"required": ["rideId"], "optional": []}'),

  ('ride_accepted', 'Ride accepted (SMS to rider)', 'sms', NULL,
   'Ocar: {{driverName}}{{driverPhoneSuffix}} has accepted your ride and is on the way to pick you up.',
   '{"required": ["driverName"], "optional": ["driverPhoneSuffix"]}'),

  ('ride_accepted', 'Ride accepted (push to rider)', 'push', 'Driver on the way',
   '{{driverName}} has accepted your ride and is on the way.',
   '{"required": ["driverName"], "optional": []}'),

  ('ride_completed', 'Ride completed (SMS to rider)', 'sms', NULL,
   'Ocar: Your ride is complete!{{fareStr}} Thank you for riding with Ocar.',
   '{"required": [], "optional": ["fareStr"]}'),

  ('ride_completed', 'Ride completed (push to rider)', 'push', 'Ride Complete',
   'Your ride is complete. Thank you for riding with Ocar!',
   '{"required": [], "optional": []}');
