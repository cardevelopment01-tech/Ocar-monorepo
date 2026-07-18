-- Stranded ride-payment recovery: proactive "payment failed" notification.
-- Push-channel template only — notifyOwner() reuses this render to build the
-- in-app feed row too (same pattern as ride_completed in 036), so no separate
-- in_app template row is needed.
INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema) VALUES
  ('payment_failed', 'Ride payment failed (push to rider)', 'push', 'Payment failed',
   'Your ₹{{amount}} ride payment didn''t go through. Tap to pay now.',
   '{"required": ["amount"], "optional": []}');
