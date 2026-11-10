-- Dispatch phase 0 (docs/superpowers/plans/2026-11-10-dispatch-phase0-fast-rounds-and-logging.md). Additive only.
-- (a) what each offer looked like when it was made, (b) one row per broadcast round that did work, (c) two switches.

ALTER TABLE ride_assignments
  ADD COLUMN straight_m integer,   -- straight-line distance driver -> pickup at offer time
  ADD COLUMN shown_m    integer,   -- distance shown on the offer card (road distance when the route call answered)
  ADD COLUMN radius_m   integer,   -- search radius that found this driver
  ADD COLUMN rank       smallint,  -- 1 = nearest in its wave
  ADD COLUMN reach      text,      -- live | background | no_socket: what the server believed about the app when it offered
  ADD COLUMN fast_step  smallint;  -- 0 = normal search, n = found at the nth widening step of an empty round

CREATE TABLE dispatch_rounds (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id         bigint NOT NULL REFERENCES rides(id) ON DELETE CASCADE,  -- a derived log: it goes with the ride, never blocks deleting one
  round           smallint NOT NULL,
  radius_m        integer NOT NULL,       -- radius the round starts with
  widest_radius_m integer NOT NULL,       -- widest radius actually searched (differs when the fast ladder ran)
  fast_step       smallint NOT NULL DEFAULT 0,
  category_ids    integer[] NOT NULL DEFAULT '{}',
  found           integer NOT NULL DEFAULT 0,
  offered         integer NOT NULL DEFAULT 0,
  live_skipped    integer NOT NULL DEFAULT 0,
  declined_skipped integer NOT NULL DEFAULT 0,
  other_skipped   integer NOT NULL DEFAULT 0,  -- spread: busy or offered before
  outcome         text NOT NULL,               -- offered | empty | closed
  diag            jsonb,                       -- why few or nobody: online_in_radius, paused, other_category, stale_position, ...
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dispatch_rounds_ride_idx ON dispatch_rounds (ride_id, round);
CREATE INDEX dispatch_rounds_created_idx ON dispatch_rounds (created_at);

INSERT INTO system_config (key, value, value_type, description) VALUES
  ('dispatch_fast_rounds_enabled', 'false', 'string',
   'Dispatch fast rounds. When ''true'' (and dispatch_no_resend_enabled is ''true''), a broadcast round that finds nobody widens the search at once (more vehicle categories, then +1 km steps up to the last round''s radius) instead of waiting for the next round''s timer. Rides still close as no drivers only in round 3.'),
  ('dispatch_decision_log_enabled', 'true', 'string',
   'Dispatch decision log. When ''true'', every broadcast round that does work writes a dispatch_rounds row (radius, found, offered, skipped, why few or nobody) and each offer records its distances. Recording never blocks dispatch.')
ON CONFLICT (key) DO NOTHING;
