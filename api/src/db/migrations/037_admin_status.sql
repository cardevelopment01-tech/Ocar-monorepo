-- Admin Onboarding & RBAC — Phase 1: admin_status enum + soft delete on admins
-- See docs/ADMIN_RBAC_PLAN.md for the full module plan.

CREATE TYPE admin_status AS ENUM ('active', 'suspended');

ALTER TABLE admins
  ADD COLUMN admin_status admin_status NOT NULL DEFAULT 'active',
  ADD COLUMN deleted_at   TIMESTAMPTZ;

-- Existing rows already default to 'active' / NULL via the column defaults above —
-- no backfill UPDATE needed.
