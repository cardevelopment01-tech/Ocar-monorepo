-- Admin Onboarding & RBAC — Phase 8: invite email template
-- See docs/ADMIN_RBAC_PLAN.md. notif_channel already has an 'email' value
-- (added ahead of this module, unused until now) — no enum change needed.

-- Body uses real newlines in the literal — a plain '...' string does not
-- interpret \n escapes (that needs E'...'), so literal backslash-n characters
-- would otherwise reach real emails.
INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema) VALUES
  ('admin_invite', 'Admin invitation (email)', 'email', 'You''ve been invited to Ocar admin',
   'Hi,

You''ve been invited to join the Ocar admin panel. Click the link below to set your password and activate your account:

{{redeemUrl}}

This link expires at {{expiresAt}}. If you weren''t expecting this invite, you can ignore this email.',
   '{"required": ["redeemUrl", "expiresAt"], "optional": []}');
