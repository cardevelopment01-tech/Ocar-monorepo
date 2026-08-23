-- Push templates for the daily sweep_document_expiry scheduler job
-- (notifyDocumentExpiring/notifyDocumentExpired in notifications.service.ts).
-- Rejection already has a working inline notifyOwner() call (admin.service.ts)
-- predating the template system -- not touched here.
INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema) VALUES
  ('document_expiring', 'Document expiring soon (push)', 'push', 'Document expiring soon',
   'Your {{docLabel}} expires in {{daysRemaining}} day(s). Please renew it to keep receiving rides.',
   '{"required": ["docLabel", "daysRemaining"], "optional": []}'),

  ('document_expired', 'Document expired (push)', 'push', 'Document expired',
   'Your {{docLabel}} has expired. You cannot go online until it is renewed and re-approved.',
   '{"required": ["docLabel"], "optional": []}');
