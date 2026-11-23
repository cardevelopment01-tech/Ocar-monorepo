-- Optional name for an invited admin, shown in the admin list and used to greet them in the invitation email. It is copied to the existing
-- admins.full_name when they accept. Expand only (nullable column): the previous release ignores it.

ALTER TABLE admin_invites ADD COLUMN IF NOT EXISTS full_name VARCHAR(120);
