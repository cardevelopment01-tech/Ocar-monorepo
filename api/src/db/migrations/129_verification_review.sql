-- Driver identity verification (PR2/3): flag mode, admin review queue, extra face references.
-- Design: docs/superpowers/specs/2026-11-02-driver-identity-verification-design.md (sections 6, 8.3, 10).
-- Nothing changes until ops sets verification_mode to 'flag'; the global switch still ships as 'off'.

-- Photos an admin has confirmed as the real driver. The onboarding selfie stays in drivers.reference_selfie_url;
-- this table only ever holds admin-confirmed extras (never auto-added, so an impostor's photo cannot poison it).
CREATE TABLE driver_face_references (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id  bigint NOT NULL REFERENCES drivers(id),
  image_url  text NOT NULL,
  source     text NOT NULL DEFAULT 'admin_confirmed' CHECK (source IN ('admin_confirmed')),
  added_by   bigint NULL REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_face_refs_driver_idx ON driver_face_references (driver_id, created_at DESC);

INSERT INTO system_config (key, value, value_type, description) VALUES
  ('verification_retake_max', '3', 'integer',
   'How many times a driver may be asked to retake an unusable selfie or plate photo in one day before it goes to an admin instead.'),
  ('verification_review_daily_budget', '30', 'integer',
   'Admin review capacity per day. Only drives the "N waiting / budget" chip; cases are never dropped.')
ON CONFLICT (key) DO NOTHING;

UPDATE system_config
   SET description = 'Driver selfie/plate verification: off (today''s behaviour), shadow (score and record only), flag (low scores queue for admin review, drivers keep working). block arrives in a later release.'
 WHERE key = 'verification_mode';
