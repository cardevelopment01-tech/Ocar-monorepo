-- The dispatch desk lists rides that found no driver, newest first. A partial index holds only those rows, so the list and its
-- count never walk the requested_at index across every ride. Additive: the previous release ignores it.
CREATE INDEX IF NOT EXISTS rides_no_drivers_idx ON rides (requested_at DESC) WHERE status = 'no_drivers';
