-- Admin Onboarding & RBAC — Phase 3: admin_audit_log
-- See docs/ADMIN_RBAC_PLAN.md. Immutable, append-only — no updated_at/trigger.
-- admin_id is nullable for system-generated actions (cron/webhook), matching the
-- existing driver_status_history.changed_by precedent.

CREATE TABLE admin_audit_log (
  id            BIGSERIAL PRIMARY KEY,
  admin_id      BIGINT REFERENCES admins(id),
  action        VARCHAR(80) NOT NULL,
  target_table  VARCHAR(60) NOT NULL,
  target_id     BIGINT NOT NULL,
  before_state  JSONB,
  after_state   JSONB,
  ip_address    VARCHAR(45),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Accountability review: "what has admin X done"
CREATE INDEX admin_audit_log_admin_idx ON admin_audit_log (admin_id, created_at DESC);

-- Support queries: "what happened to driver #123"
CREATE INDEX admin_audit_log_target_idx ON admin_audit_log (target_table, target_id, created_at DESC);

-- Security dashboard: recent actions across all admins
CREATE INDEX admin_audit_log_recent_idx ON admin_audit_log (created_at DESC);
