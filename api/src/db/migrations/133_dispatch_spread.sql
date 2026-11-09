-- Dispatch phase 4, step 5a (docs/superpowers/plans/2026-11-08-dispatch-spread-to-more-drivers.md). Additive only; off until both
-- switches are set. rides.dispatch_spread is stamped at booking (like dispatch_variant) so a switch change never alters a ride in flight.
ALTER TABLE rides ADD COLUMN dispatch_spread smallint NOT NULL DEFAULT 0;

INSERT INTO system_config (key, value, value_type, description) VALUES
  ('dispatch_spread_enabled', 'false', 'string',
   'Dispatch spread (5a). When ''true'' AND the ride''s city is listed in dispatch_spread_city_ids (and dispatch_no_resend_enabled is ''true''), rides booked from now on remember which drivers they already offered and prefer drivers who hold no other live offer.'),
  ('dispatch_spread_city_ids', '', 'string',
   'City ids the spread engine is on for, comma separated (e.g. 1,2). Empty = no city. Only read when dispatch_spread_enabled is ''true''.')
ON CONFLICT (key) DO NOTHING;
