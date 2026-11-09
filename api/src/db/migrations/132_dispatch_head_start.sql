-- Dispatch experiment (docs/superpowers/plans/2026-11-08-dispatch-spread-to-more-drivers.md, section 3i). Needs dispatch_no_resend_enabled
-- on as well. When 'true', rides booked from now on (dispatch_variant 2) offer round 1 to the 2 nearest drivers 2.5 s before the others.
INSERT INTO system_config (key, value, value_type, description) VALUES
  ('dispatch_head_start_enabled', 'false', 'string',
   'Dispatch experiment. When ''true'' (and dispatch_no_resend_enabled is ''true''), rides booked from now on offer round 1 to the 2 nearest drivers 2.5 s before the other drivers. Rides already booked keep their rules.')
ON CONFLICT (key) DO NOTHING;
