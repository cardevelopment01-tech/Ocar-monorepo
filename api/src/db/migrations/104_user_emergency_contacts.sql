-- Rider-side safety contacts: up to 3 people Ocar texts (with ride + live location) when the rider
-- triggers SOS. Distinct from drivers.emergency_contact (one number, never contacted by the platform).
CREATE TABLE user_emergency_contacts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(60) NOT NULL,
  phone       VARCHAR(15) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, phone)
);

CREATE INDEX user_emergency_contacts_user_idx ON user_emergency_contacts (user_id, created_at);

-- Sent to a rider's contacts on SOS. Needs a DLT-registered template with this exact wording
-- before the SMS vendor will deliver it in production (register it with the SMS vendor before relying on it).
INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema) VALUES
  ('sos_contact', 'SOS alert (SMS to rider''s emergency contact)', 'sms', NULL,
   'Ocar SAFETY ALERT: {{riderName}} pressed the SOS button during an Ocar ride and may need help. Last location: https://maps.google.com/?q={{lat}},{{lng}}. Please call them now.',
   '{"required": ["riderName", "lat", "lng"], "optional": []}');
