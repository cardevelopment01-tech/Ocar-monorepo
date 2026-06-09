-- Module M08/M11: system_config table for runtime configuration
-- Enums config_value_type and config_status defined in 002_enums.sql

CREATE TABLE system_config (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key         VARCHAR(80) UNIQUE NOT NULL,
  value       TEXT NOT NULL,
  value_type  config_value_type NOT NULL DEFAULT 'string',
  description TEXT NULL,
  is_public   BOOLEAN NOT NULL DEFAULT false,
  status      config_status NOT NULL DEFAULT 'active',
  updated_by  BIGINT NULL REFERENCES admins(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX system_config_key_idx ON system_config (key)
  WHERE status = 'active';

CREATE TRIGGER trg_system_config_updated_at
  BEFORE UPDATE ON system_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
