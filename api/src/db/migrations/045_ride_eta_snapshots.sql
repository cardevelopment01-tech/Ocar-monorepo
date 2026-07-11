-- Predicted routing-engine ETA at the start of each ride leg, logged for later
-- comparison against actual elapsed time (rides.accepted_at/driver_arrived_at/
-- started_at/completed_at already capture the actuals — nothing new needed there).
-- See docs/PRODUCTION_NAVIGATION_SYSTEM_PLAN.md Phase 4: this is instrumentation
-- only, not an ML model — the goal is to have real data if ETA accuracy becomes
-- a complaint later, not to build a correction model today.
CREATE TABLE ride_eta_snapshots (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id                BIGINT NOT NULL REFERENCES rides(id),
  leg                    TEXT NOT NULL CHECK (leg IN ('to_pickup', 'to_destination')),
  predicted_duration_min NUMERIC(8,2) NOT NULL,
  provider               TEXT NOT NULL DEFAULT 'google_directions',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ride_id, leg)
);

CREATE INDEX idx_ride_eta_snapshots_ride_id ON ride_eta_snapshots(ride_id);
