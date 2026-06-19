-- Schema alignment: admins table
-- Adds missing columns from planned schema. full_name added as nullable.

ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS full_name        VARCHAR(120),
  ADD COLUMN IF NOT EXISTS last_login_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_ip    VARCHAR(45),
  ADD COLUMN IF NOT EXISTS totp_secret_enc  TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by       BIGINT REFERENCES admins(id);
