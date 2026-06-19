-- Schema alignment: users table
-- Adds missing columns from planned schema. No renames, no drops.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url          TEXT,
  ADD COLUMN IF NOT EXISTS is_profile_complete BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_rides         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_avg          DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS rating_count        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deleted_at          TIMESTAMPTZ;
