-- Driver identity verification (PR3/3): re-check after random rides or a long ride, block mode, consent.
-- Design: docs/superpowers/specs/2026-11-02-driver-identity-verification-design.md (section 9.5, design review DD3/DD4).
-- spot_check_enabled ships 'false' and verification_mode is still 'off': deploying this changes nothing for drivers.

-- One open challenge per driver at a time (the partial unique index enforces it under concurrent completions).
CREATE TABLE verification_challenges (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id    bigint NOT NULL REFERENCES drivers(id),
  reason       text NOT NULL CHECK (reason IN ('rides', 'long_ride', 'admin')),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'satisfied', 'waived')),
  opened_at    timestamptz NOT NULL DEFAULT now(),
  satisfied_at timestamptz,
  waived_by    bigint REFERENCES admins(id),
  waived_at    timestamptz,
  trigger_data jsonb
);
CREATE UNIQUE INDEX verification_challenges_one_open
  ON verification_challenges (driver_id) WHERE status = 'open';

-- The random "after N rides" target, persisted so an app restart or retry cannot reroll it.
CREATE TABLE driver_spot_check_state (
  driver_id    bigint PRIMARY KEY REFERENCES drivers(id),
  rides_target smallint NOT NULL,
  drawn_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE driver_verifications ADD COLUMN challenge_id bigint REFERENCES verification_challenges(id);

-- One-time consent for face and plate checks (design review DD4). Stored per driver with the app version that showed it.
ALTER TABLE drivers
  ADD COLUMN verification_consent_at          timestamptz,
  ADD COLUMN verification_consent_app_version text;

INSERT INTO system_config (key, value, value_type, description) VALUES
  ('spot_check_enabled', 'false', 'string',
   'Re-check: after a random number of rides, or a long ride, take the driver offline until they redo the selfie and plate check. Only applies while verification_mode is not off.'),
  ('spot_check_rides_min', '2', 'integer',
   'Re-check target is drawn at random between this and spot_check_rides_max completed rides since the last verified check.'),
  ('spot_check_rides_max', '3', 'integer',
   'Upper end of the random re-check target (completed rides since the last verified check).'),
  ('spot_check_long_ride_km', '60', 'decimal',
   'A completed one-way or round-trip ride at or above this distance always triggers a re-check.'),
  ('spot_check_long_ride_minutes', '90', 'integer',
   'A completed one-way or round-trip ride at or above this duration always triggers a re-check.')
ON CONFLICT (key) DO NOTHING;

-- Push shown when the driver is taken offline for a re-check. The trigger is never named (calm, not an accusation).
INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema) VALUES
  ('verification_required', 'Quick safety check (push to driver)', 'push', 'Quick safety check',
   'Quick safety check to keep going. Take a selfie and a photo of your number plate to go online.',
   '{"required": [], "optional": []}');

UPDATE system_config
   SET description = 'Driver selfie/plate verification: off (today''s behaviour), shadow (score and record only), flag (low scores queue for admin review, drivers keep working), block (a selfie that does not match stops the driver until an admin clears it).'
 WHERE key = 'verification_mode';
