-- Add refresh-token family tracking for rotation and replay detection.

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS family_id UUID,
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replaced_by_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS reuse_detected_at TIMESTAMPTZ;

UPDATE refresh_tokens
SET family_id = gen_random_uuid()
WHERE family_id IS NULL;

ALTER TABLE refresh_tokens
  ALTER COLUMN family_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx
  ON refresh_tokens (family_id);

