-- Driver identity verification (PR1/3): scoring columns, attempt history, per-driver mode override, config switches.
-- Design: docs/superpowers/specs/2026-11-02-driver-identity-verification-design.md
-- verification_mode ships as 'off': deploying this changes nothing until ops sets 'shadow' (score and record only).

ALTER TABLE driver_verifications
  ADD COLUMN match_similarity numeric(5,2),
  ADD COLUMN face_quality     jsonb,
  ADD COLUMN ocr_text         text,
  ADD COLUMN ocr_confidence   numeric(5,2),
  ADD COLUMN decision         text CHECK (decision IN ('pass','review','fail','retake','error','skipped')),
  ADD COLUMN decision_reason  text,
  ADD COLUMN mode             text CHECK (mode IN ('shadow','flag','block')),
  ADD COLUMN thresholds       jsonb,
  ADD COLUMN review_state     text NOT NULL DEFAULT 'none'
                               CHECK (review_state IN ('none','queued','confirmed_ok','confirmed_mismatch')),
  ADD COLUMN review_priority  smallint NOT NULL DEFAULT 0,
  ADD COLUMN reviewed_by      bigint REFERENCES admins(id),
  ADD COLUMN reviewed_at      timestamptz;

-- Equality predicate on a text column is IMMUTABLE, so it is allowed in a partial index.
CREATE INDEX driver_verif_review_queue_idx
  ON driver_verifications (review_priority DESC, created_at)
  WHERE review_state = 'queued';

-- One row per scored submission, kept even when the daily row is later replaced by a retake (design decision D4).
CREATE TABLE driver_verification_attempts (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id      bigint NOT NULL REFERENCES drivers(id),
  vehicle_id     bigint NULL REFERENCES driver_vehicles(id),
  kind           verification_kind NOT NULL,
  verified_for   date NOT NULL,
  image_url      text NOT NULL,
  decision       text NOT NULL CHECK (decision IN ('pass','review','fail','retake','error','skipped')),
  decision_reason text,
  match_similarity numeric(5,2),
  face_quality   jsonb,
  ocr_text       text,
  ocr_confidence numeric(5,2),
  mode           text NOT NULL CHECK (mode IN ('shadow','flag','block')),
  thresholds     jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_verif_attempts_driver_idx
  ON driver_verification_attempts (driver_id, created_at DESC);

-- Per-driver override of the global mode (pilots; exempting seeded load-test drivers). NULL = follow the global mode.
ALTER TABLE drivers
  ADD COLUMN verification_mode_override text
    CHECK (verification_mode_override IN ('off','shadow','flag','block'));

INSERT INTO system_config (key, value, value_type, description) VALUES
  ('verification_mode', 'off', 'string',
   'Driver selfie/plate scoring: off (today''s behaviour), shadow (score and record, never block). flag and block arrive in a later release.'),
  ('verification_face_pass_min', '90', 'decimal',
   'Face similarity (0-100) at or above this passes. Starting value; calibrate in shadow mode.'),
  ('verification_face_review_min', '75', 'decimal',
   'Face similarity between this and the pass minimum goes to review; below it is a fail. Starting value.'),
  ('verification_plate_max_edits', '1', 'integer',
   'Plate OCR edit distance (after folding look-alike characters) still counted as a match.'),
  ('verification_plate_review_edits', '2', 'integer',
   'Plate OCR edit distance above max_edits but within this goes to review; above it is a fail.'),
  ('verification_min_brightness', '35', 'decimal',
   'Face photo brightness (0-100) below this is a retake. Starting value.'),
  ('verification_min_sharpness', '35', 'decimal',
   'Face photo sharpness (0-100) below this is a retake. Starting value.')
ON CONFLICT (key) DO NOTHING;
