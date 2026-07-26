-- Metered wait time at intermediary stops (one-way rides only).
-- One-way is per-km/per-min on a frozen estimate, so dwell at a stop is
-- otherwise unbilled. We measure it server-side: arrived_at is stamped when the
-- driver reaches the stop, reached_at when they resume; wait_charge is computed
-- from that server-measured dwell (minus the free window) at resume time and
-- folded into total_final at settlement. Round-trip/rental never set arrived_at
-- (their wait is absorbed by the hours package), so wait_charge stays 0.

ALTER TABLE ride_stops
  ADD COLUMN arrived_at  TIMESTAMPTZ NULL,
  ADD COLUMN wait_charge NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (wait_charge >= 0);
