-- "Sign this admin out now": any access token issued before this moment is refused, even though it has not expired yet (they last 15
-- minutes). Without it, revoking refresh tokens would leave a removed or signed-out admin working for up to 15 more minutes.
-- Expand only (backward compatible): a new nullable column. The previous release ignores it.

ALTER TABLE admins ADD COLUMN IF NOT EXISTS sessions_valid_from TIMESTAMPTZ;
