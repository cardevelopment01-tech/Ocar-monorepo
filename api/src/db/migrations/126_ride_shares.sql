-- 126_ride_shares.sql
-- Live trip sharing: a rider shares a link that anyone can open (no app, no login) to follow the trip on a map.
-- The raw token is never stored, only its SHA-256 (same rule as refresh tokens), so a database leak yields no usable links.
-- Expiry is computed (ride end + 30 minutes, hard cap 7 days after creation), not stored. Account deletion keeps the users
-- row, so these rows are removed explicitly by deleteAccount; the purge job is the backstop.
CREATE TABLE ride_shares (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id         BIGINT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      CHAR(64) NOT NULL UNIQUE,
  recipient_label VARCHAR(60),
  recipient_phone VARCHAR(15),
  is_sos          BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  first_viewed_at TIMESTAMPTZ,
  last_viewed_at  TIMESTAMPTZ,
  view_count      INT NOT NULL DEFAULT 0
);
CREATE INDEX ride_shares_ride_idx ON ride_shares (ride_id) WHERE revoked_at IS NULL;
CREATE INDEX ride_shares_user_created_idx ON ride_shares (user_id, created_at);

-- Kill switch. Off until the SMS wordings below are DLT-approved and QA has passed.
INSERT INTO system_config (key, value, value_type, is_public, description) VALUES
  ('trip_share_enabled', 'false', 'boolean', false, 'Live trip sharing. true: riders can share a trip link and SOS texts carry a live link. false: the feature is off and SOS keeps the static map pin.')
ON CONFLICT (key) DO NOTHING;

-- SMS wordings. Both need DLT registration with this exact text before the SMS vendor delivers them in production, so they
-- ship INACTIVE. The domain and the /t/ path are fixed text (DLT only accepts a whitelisted domain); the link's token is the only
-- variable, next to the rider's first name. Register them as written in docs/DLT_TEMPLATES_TRIP_SHARE.md, with {{x}} as {#var#}: a render of an inactive template fails, which is the signal for the callers to fall back (trip_share: "SMS not
-- sent, share the link instead"; SOS: the old static-pin sos_contact SMS). Activate each in admin once its DLT template is approved.
INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema, is_active) VALUES
  ('trip_share', 'Live trip link (SMS to a saved contact)', 'sms', NULL,
   'Ocar: {{riderName}} is sharing a live ride with you. Track it here: https://ocarindia.com/t/{{trackToken}}',
   '{"required": ["riderName", "trackToken"], "optional": []}', false),
  ('sos_contact_live', 'SOS alert with live link (SMS to rider''s emergency contact)', 'sms', NULL,
   'Ocar SAFETY ALERT: {{riderName}} pressed the SOS button during an Ocar ride and may need help. Live location: https://ocarindia.com/t/{{trackToken}} Please call them now.',
   '{"required": ["riderName", "trackToken"], "optional": []}', false);
