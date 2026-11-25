-- Admin audit trail v2: richer context per entry + a tamper-evident hash chain.
-- admin_audit_log stays append-only (042). ADD COLUMN is allowed; old rows are never rewritten, so
-- the new columns are nullable / defaulted and old rows simply have no chain position (chain_seq IS NULL).

ALTER TABLE admin_audit_log
  ALTER COLUMN target_id DROP NOT NULL,                    -- creates and list-level actions have no single target
  ADD COLUMN occurred_at    TIMESTAMPTZ DEFAULT now(),     -- when the action happened; created_at is when the row was stored
  ADD COLUMN outcome        TEXT NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failure', 'denied')),
  ADD COLUMN source         TEXT NOT NULL DEFAULT 'service' CHECK (source IN ('service', 'http', 'auth', 'system')),
  ADD COLUMN request_id     TEXT,
  ADD COLUMN user_agent     TEXT,
  ADD COLUMN actor_email    TEXT,                          -- snapshot: the admin's email/role at the time, survives later edits
  ADD COLUMN actor_role     TEXT,
  ADD COLUMN changed_fields TEXT[],
  ADD COLUMN summary        TEXT,
  ADD COLUMN http_method    TEXT,
  ADD COLUMN http_path      TEXT,
  ADD COLUMN http_status    INT,
  ADD COLUMN chain_seq      BIGINT,
  ADD COLUMN prev_hash      TEXT,
  ADD COLUMN event_hash     TEXT;

-- The one definition of "what is hashed", used by the insert trigger and by the verifier so they cannot drift.
CREATE FUNCTION audit_event_hash(r admin_audit_log) RETURNS TEXT AS $$
  SELECT encode(sha256(convert_to(
    concat_ws('|',
      r.chain_seq::text,
      r.prev_hash,
      r.id::text,
      COALESCE(r.admin_id::text, ''),
      r.action,
      r.target_table,
      COALESCE(r.target_id::text, ''),
      r.outcome,
      r.source,
      COALESCE(r.before_state::text, ''),
      COALESCE(r.after_state::text, ''),
      COALESCE(r.reason, ''),
      COALESCE(r.ip_address, ''),
      COALESCE(r.request_id, ''),
      to_char(r.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
    ), 'UTF8')), 'hex')
$$ LANGUAGE sql STABLE;

-- Every insert is chained to the one before it. An advisory lock serialises writers so two concurrent
-- inserts cannot claim the same position. Admin write volume is low, so the lock is not a bottleneck.
CREATE FUNCTION admin_audit_log_chain() RETURNS trigger AS $$
DECLARE
  last_seq  BIGINT;
  last_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(7240162);
  SELECT chain_seq, event_hash INTO last_seq, last_hash
    FROM admin_audit_log WHERE chain_seq IS NOT NULL ORDER BY chain_seq DESC LIMIT 1;
  NEW.occurred_at := COALESCE(NEW.occurred_at, now());
  NEW.chain_seq   := COALESCE(last_seq, 0) + 1;
  NEW.prev_hash   := COALESCE(last_hash, repeat('0', 64));
  NEW.event_hash  := audit_event_hash(NEW);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_audit_log_chain
  BEFORE INSERT ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION admin_audit_log_chain();

-- Emptying the table would silently restart the chain. Blocked unless a session deliberately opts in
-- (the test helper does, inside a transaction).
CREATE FUNCTION prevent_admin_audit_log_truncate() RETURNS trigger AS $$
BEGIN
  IF COALESCE(current_setting('ocar.allow_audit_truncate', true), '') <> 'on' THEN
    RAISE EXCEPTION 'admin_audit_log is append-only — TRUNCATE is not permitted';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_audit_log_no_truncate
  BEFORE TRUNCATE ON admin_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_admin_audit_log_truncate();

CREATE UNIQUE INDEX admin_audit_log_chain_seq_idx ON admin_audit_log (chain_seq) WHERE chain_seq IS NOT NULL;
CREATE INDEX admin_audit_log_action_idx ON admin_audit_log (action, id DESC);
CREATE INDEX admin_audit_log_request_idx ON admin_audit_log (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX admin_audit_log_problem_idx ON admin_audit_log (id DESC) WHERE outcome <> 'success';
