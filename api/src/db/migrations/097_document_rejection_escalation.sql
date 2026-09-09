-- Tracks how many times a document has been rejected, so a repeat rejection
-- of the same doc can be distinguished from a first-time one (notification
-- copy, escalation to admins/SMS). Reset to 0 (and rejection_note cleared)
-- on approve -- see admin.repository.ts.
ALTER TABLE driver_documents ADD COLUMN rejection_count smallint NOT NULL DEFAULT 0;
ALTER TABLE driver_vehicle_documents ADD COLUMN rejection_count smallint NOT NULL DEFAULT 0;

-- Moves document_rejected off the hardcoded notifyOwner() string in
-- admin.service.ts onto the template system, matching document_expiring/
-- document_expired (090_document_expiry_notification_templates.sql).
-- follow_up_note is composed in code from rejection_count (empty on the
-- 1st rejection, a specific sentence on the 2nd, an escalation sentence on
-- the 3rd+) -- the template system only does flat {{var}} substitution, no
-- conditionals, so the tiering logic stays in admin.service.ts and this
-- template just has a slot for it.
INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema) VALUES
  ('document_rejected', 'Document rejected (push)', 'push', 'Document Rejected',
   'Your {{doc_name}} needs another look: {{reason}}.{{follow_up_note}} Tap to fix and resubmit.',
   '{"required": ["doc_name", "reason", "follow_up_note"], "optional": []}'),

  ('document_rejected', 'Document rejected, 3rd+ time (SMS to driver)', 'sms', NULL,
   'Ocar: Your {{doc_name}} was rejected again ({{rejection_count}}x). Our support team will contact you. Fix it in the app or call support.',
   '{"required": ["doc_name", "rejection_count"], "optional": []}'),

  ('document_rejection_escalated', 'Document rejected 3+ times (push to admins)', 'push', 'Repeat document rejection',
   '{{driverName}} ({{driverPhone}})''s {{docName}} has been rejected {{rejectionCount}} times. May need manual follow-up.',
   '{"required": ["driverName", "driverPhone", "docName", "rejectionCount"], "optional": []}');
