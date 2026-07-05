-- Audit columns for early round-trip termination fare adjustments
ALTER TABLE fare_snapshots
  ADD COLUMN IF NOT EXISTS early_termination_km  NUMERIC(8,2) NULL,
  ADD COLUMN IF NOT EXISTS early_termination_min NUMERIC(8,2) NULL;
