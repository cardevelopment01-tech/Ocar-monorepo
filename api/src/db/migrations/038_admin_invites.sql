-- Admin Onboarding & RBAC — Phase 2: admin_invites (token-based onboarding)
-- See docs/ADMIN_RBAC_PLAN.md. The admins row is created only on redemption —
-- this table holds all pending-invite state, so admin_status never needs an
-- 'invited' value.

CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'expired', 'revoked');

CREATE TABLE admin_invites (
  id                 BIGSERIAL PRIMARY KEY,
  email              CITEXT NOT NULL,
  role               admin_role NOT NULL,
  token_hash         TEXT NOT NULL,
  invited_by         BIGINT NOT NULL REFERENCES admins(id),
  status             invite_status NOT NULL DEFAULT 'pending',
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '48 hours'),
  accepted_at        TIMESTAMPTZ,
  accepted_admin_id  BIGINT REFERENCES admins(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Redemption hot path: look up by raw token's hash
CREATE UNIQUE INDEX admin_invites_token_hash_idx ON admin_invites (token_hash);

-- Block sending a second invite to an email that already has a pending one
CREATE INDEX admin_invites_email_status_idx ON admin_invites (email, status);

-- Expiry sweep job: find pending invites past expires_at
CREATE INDEX admin_invites_status_expiry_idx ON admin_invites (status, expires_at);

CREATE TRIGGER admin_invites_updated_at
  BEFORE UPDATE ON admin_invites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
