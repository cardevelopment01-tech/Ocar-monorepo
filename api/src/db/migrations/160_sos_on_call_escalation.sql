-- SOS response chain. Expand-only: two columns with defaults, nothing read by older code.
-- admins.sos_on_call: this admin has said they are on duty for SOS alerts right now (they set it themselves on the SOS page).
-- sos_alerts.escalation_level: how far the "nobody has picked this up" reminders have gone (0 none, 1 on-call reminder, 2 everyone).
ALTER TABLE admins ADD COLUMN sos_on_call BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sos_alerts ADD COLUMN escalation_level SMALLINT NOT NULL DEFAULT 0;
