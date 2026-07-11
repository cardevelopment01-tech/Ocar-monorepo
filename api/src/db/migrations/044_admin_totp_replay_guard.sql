-- Admin TOTP/2FA — replay protection.
-- See docs/ADMIN_RBAC_PLAN.md. RFC 6238 recommends rejecting a time step at
-- or before the last one successfully used, so an intercepted valid code
-- can't be replayed within its own ~30-90s validity window. otplib's
-- verify() supports this natively via `afterTimeStep`.

ALTER TABLE admins ADD COLUMN totp_last_timestep BIGINT;
