-- Who put a document file in place. NULL = the driver uploaded it themselves;
-- set = an admin uploaded it on the driver's behalf (support flow).
ALTER TABLE driver_documents
  ADD COLUMN IF NOT EXISTS uploaded_by_admin_id BIGINT REFERENCES admins(id) ON DELETE SET NULL;
ALTER TABLE driver_vehicle_documents
  ADD COLUMN IF NOT EXISTS uploaded_by_admin_id BIGINT REFERENCES admins(id) ON DELETE SET NULL;
