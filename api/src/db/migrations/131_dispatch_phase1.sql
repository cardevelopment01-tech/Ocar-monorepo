-- Dispatch phase 1 (docs/superpowers/plans/2026-11-08-dispatch-spread-to-more-drivers.md, sections 0 and 3g).
-- Additive only, and nothing changes for riders or drivers until `dispatch_no_resend_enabled` is switched on:
--   * rides.dispatch_variant   which dispatch rules a ride was created under, stamped ONCE at booking so a flag flip never
--                              changes a ride already in flight. 0 = today's behaviour.
--   * ride_assignments.acked_at  when the driver's live app confirmed it received the offer (the ack used to exist only as a
--                              Redis key and a log line, so delivery could not be measured or ranked on).
--   * an index for "offers this driver received recently" (the existing driver/offered_at index covers open offers only).
-- On prd these tables hold hundreds of rows, so a plain (non-concurrent) index build is instant.

ALTER TABLE rides ADD COLUMN dispatch_variant smallint NOT NULL DEFAULT 0;
ALTER TABLE ride_assignments ADD COLUMN acked_at timestamptz;

CREATE INDEX ride_assignments_driver_offered_idx ON ride_assignments (driver_id, offered_at);

INSERT INTO system_config (key, value, value_type, description) VALUES
  ('dispatch_no_resend_enabled', 'false', 'string',
   'Dispatch phase 1. When ''true'', rides booked from now on never re-send a still-open offer to the same driver in a later round, cap concurrent open offers per ride, push at once to a driver with no live connection (otherwise after 2 s instead of 4 s) and use a 30 s window for a backgrounded driver. Rides already booked keep the rules they were stamped with.')
ON CONFLICT (key) DO NOTHING;
