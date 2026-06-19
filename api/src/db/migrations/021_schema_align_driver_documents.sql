-- Schema alignment: driver_documents table
-- Adds missing columns from planned schema. Enum and constraint changes deferred.

ALTER TABLE driver_documents
  ADD COLUMN IF NOT EXISTS valid_from  DATE,
  ADD COLUMN IF NOT EXISTS valid_until DATE;
