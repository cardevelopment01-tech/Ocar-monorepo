-- Admin TOTP/2FA — recovery codes.
-- See docs/ADMIN_RBAC_PLAN.md. One row per single-use recovery code, generated
-- at TOTP enrollment. Codes are hashed (bcrypt, like passwords) — never
-- stored raw. Re-enrollment/regeneration deletes old rows and inserts fresh
-- ones (all-or-nothing, no partial regen).

CREATE TABLE admin_recovery_codes (
  id         BIGSERIAL PRIMARY KEY,
  admin_id   BIGINT NOT NULL REFERENCES admins(id),
  code_hash  TEXT NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Load all unused codes for an admin at verify time
CREATE INDEX admin_recovery_codes_admin_idx ON admin_recovery_codes (admin_id, used_at);
