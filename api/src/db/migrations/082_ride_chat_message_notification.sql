-- Ride chat pushes the OTHER participant an FCM + in-app notification for each
-- new message (via notifyOwner()), so the offline/backgrounded party learns of
-- a message without the socket. This is the single push template that call site
-- renders. Body carries a short preview of the message text.
INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema) VALUES
  ('ride_chat_message', 'New ride chat message (push to other participant)', 'push', 'New message',
   '{{preview}}',
   '{"required": ["preview"], "optional": []}');
