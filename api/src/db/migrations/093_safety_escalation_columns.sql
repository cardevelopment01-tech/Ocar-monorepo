-- §03.4: escalated_at makes the SLA sweeps idempotent — once an alert/dispute
-- has been escalated to admins, the next sweep tick skips it (WHERE escalated_at
-- IS NULL) instead of re-paging every 5 minutes forever.
ALTER TABLE sos_alerts ADD COLUMN escalated_at TIMESTAMPTZ NULL;
ALTER TABLE disputes   ADD COLUMN escalated_at TIMESTAMPTZ NULL;
