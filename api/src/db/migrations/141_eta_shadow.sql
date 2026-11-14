-- Phase B of docs/superpowers/plans/2026-11-10-google-maps-cost.md: "shadow ETA". While eta_shadow_enabled is 'true', the API samples the ETA it
-- WOULD give from a ride's stored route and driver progress (kind 'ours') next to the ETA Google gave the rider (kind 'google'), so the two
-- can be compared with the real arrival time before anything changes for users. Additive only; nothing reads this table except the report
-- in api/scripts/eta-shadow-report.sql. Rows are deleted after ETA_SHADOW_RETENTION_DAYS (90) by a daily job.
CREATE TABLE ride_eta_shadow (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id      bigint NOT NULL REFERENCES rides(id) ON DELETE CASCADE,  -- derived data: it goes with the ride
  leg          text NOT NULL CHECK (leg IN ('to_pickup', 'to_destination')),
  kind         text NOT NULL CHECK (kind IN ('ours', 'google')),
  at           timestamptz NOT NULL DEFAULT now(),
  eta_sec      integer NOT NULL,   -- ours: remaining distance at a blended speed; google: the duration Google returned to the rider
  eta_base_sec integer,            -- ours only: remaining distance at the speed Google's route implied (snap and trim)
  remaining_m  integer,            -- distance left to the leg's destination
  off_route_m  integer             -- ours only: how far the vehicle was from the stored route line
);
CREATE INDEX ride_eta_shadow_ride_idx ON ride_eta_shadow (ride_id, at);
CREATE INDEX ride_eta_shadow_at_idx ON ride_eta_shadow (at);

INSERT INTO system_config (key, value, value_type, description) VALUES
  ('eta_shadow_enabled', 'false', 'string',
   'Shadow ETA. When ''true'', the API keeps each ride leg''s route (the one it already fetches for the ETA snapshot) in Redis for up to 6 hours and logs the ETA it would give from that route and the driver''s progress next to the ETA Google gave the rider. Nothing a rider or driver sees changes, and no extra Google requests are made. Turn on only after the Google Maps terms on temporary route storage have been checked.')
ON CONFLICT (key) DO NOTHING;
