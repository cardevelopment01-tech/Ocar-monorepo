-- admin_audit_log is immutable (see 042) — this only ALTERs to add a column,
-- which the immutability triggers don't block (they guard UPDATE/DELETE on rows).
ALTER TABLE admin_audit_log ADD COLUMN reason TEXT;
