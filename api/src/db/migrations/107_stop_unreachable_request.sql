-- Driver says they cannot reach a pending stop. The rider is asked to skip it (the driver can no
-- longer skip on their own). Nullable: null = no request. Cleared implicitly once the stop leaves 'pending'.
-- Additive and nullable, so the previous release (which never reads or writes it) keeps working.
ALTER TABLE ride_stops ADD COLUMN IF NOT EXISTS unreachable_requested_at timestamptz;
