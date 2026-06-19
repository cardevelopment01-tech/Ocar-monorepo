-- Schema alignment: drivers table
-- Adds missing columns from planned schema. No renames, no drops, no constraint changes.

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS reference_selfie_url TEXT,
  ADD COLUMN IF NOT EXISTS license_expiry       DATE,
  ADD COLUMN IF NOT EXISTS total_rides          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_avg           DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS rating_count         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_earnings       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS approved_by          BIGINT REFERENCES admins(id),
  ADD COLUMN IF NOT EXISTS approved_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at           TIMESTAMPTZ;
