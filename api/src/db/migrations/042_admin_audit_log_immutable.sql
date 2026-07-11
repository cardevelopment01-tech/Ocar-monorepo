-- Admin Onboarding & RBAC — audit log tamper-evidence.
-- See docs/ADMIN_RBAC_PLAN.md. The app connects as the postgres superuser,
-- so a plain REVOKE UPDATE/DELETE would be a no-op (superusers bypass grant
-- checks). A trigger still fires regardless of role, so this is the only
-- mechanism that actually blocks mutation here — including a compromised
-- or malicious super_admin session going straight to SQL.

CREATE FUNCTION prevent_admin_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only — % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_audit_log_no_update
  BEFORE UPDATE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_log_mutation();

CREATE TRIGGER admin_audit_log_no_delete
  BEFORE DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_log_mutation();
