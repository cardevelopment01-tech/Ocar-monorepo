-- Tracks the BullMQ job id for a force-assign's grace-period revert check
-- (see docs/superpowers/specs/2026-08-09-admin-manual-driver-assignment-design.md).
-- Nullable/no default: only set while a force-assigned ride's grace window is open.
ALTER TABLE rides ADD COLUMN force_assign_grace_job_id TEXT NULL;
