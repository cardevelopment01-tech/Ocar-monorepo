-- How each ride offer reached the driver, so missed requests can be split by app state (open, background, closed).
-- Phase 0 of docs/superpowers/plans/2026-11-05-driver-app-closed-ride-alert-overlay.md. Additive and nullable: old rows stay NULL
-- ("not recorded"), nothing reads these columns on a request path, so old and new code can run side by side during a deploy.
--
--   offered_backgrounded  the server believed the driver's app was in the background when the offer was made (the same flag
--                         that already shortens or lengthens the accept window)
--   acked_at              the app confirmed over the live socket that it received the request card (app open, socket alive)
--   pushed_at             the server sent the ride-request push for this offer (set once, when the push guard is first taken)
--
-- Reading them: acked_at set = the app saw it live; acked_at NULL and pushed_at set = only the notification could have reached
-- the driver (app backgrounded or closed); both NULL = neither path is known to have delivered.
ALTER TABLE ride_assignments
  ADD COLUMN IF NOT EXISTS offered_backgrounded BOOLEAN,
  ADD COLUMN IF NOT EXISTS acked_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pushed_at            TIMESTAMPTZ;
