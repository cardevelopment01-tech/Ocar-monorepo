CREATE TABLE IF NOT EXISTS device_tokens (
  id           BIGSERIAL PRIMARY KEY,
  owner_type   TEXT NOT NULL CHECK (owner_type IN ('user','driver','admin')),
  owner_id     BIGINT NOT NULL,
  token        TEXT NOT NULL UNIQUE,
  platform     TEXT NOT NULL DEFAULT 'web' CHECK (platform IN ('web','android','ios')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_owner
  ON device_tokens (owner_type, owner_id);

CREATE TRIGGER device_tokens_updated_at
  BEFORE UPDATE ON device_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
