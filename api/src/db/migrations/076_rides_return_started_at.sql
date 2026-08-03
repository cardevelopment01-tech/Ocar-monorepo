-- return_started_at: set when the driver slides "Start Return" on a
-- round_trip ride (in_progress -> returning). NULL for every other
-- ride type/status. Purely a UX/status marker — the round-trip fare
-- model (074_round_trip_package_billing.sql) does not read this column,
-- it reconciles off actual GPS-derived km/duration regardless of when
-- (or whether) a return leg was explicitly marked.
ALTER TABLE rides
  ADD COLUMN return_started_at TIMESTAMPTZ NULL;
