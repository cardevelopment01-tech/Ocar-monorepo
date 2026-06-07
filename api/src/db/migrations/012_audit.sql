-- M02: Audit log tables
-- These reference users/drivers but use ON DELETE SET NULL so audit records
-- survive account deletion.

CREATE TABLE user_audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    BIGINT,
  old_data     JSONB,
  new_data     JSONB,
  ip_address   INET,
  user_agent   TEXT,
  request_id   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX user_audit_logs_user_id_idx
  ON user_audit_logs (user_id, created_at DESC);
CREATE INDEX user_audit_logs_action_idx
  ON user_audit_logs (action, created_at DESC);

CREATE TABLE driver_audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  driver_id    BIGINT REFERENCES drivers(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    BIGINT,
  old_data     JSONB,
  new_data     JSONB,
  ip_address   INET,
  user_agent   TEXT,
  request_id   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX driver_audit_logs_driver_id_idx
  ON driver_audit_logs (driver_id, created_at DESC);
CREATE INDEX driver_audit_logs_action_idx
  ON driver_audit_logs (action, created_at DESC);
