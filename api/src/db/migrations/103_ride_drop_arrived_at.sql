-- When the driver tapped "Arrived at drop". The rider's end PIN is only shown after this, so it is not
-- sitting on screen for the whole trip. Nullable: rides that never reach a drop (cancelled, ended early) leave it null.
ALTER TABLE rides ADD COLUMN IF NOT EXISTS drop_arrived_at timestamptz;
