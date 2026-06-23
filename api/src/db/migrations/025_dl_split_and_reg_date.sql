ALTER TYPE doc_type ADD VALUE IF NOT EXISTS 'driving_license_front';
ALTER TYPE doc_type ADD VALUE IF NOT EXISTS 'driving_license_back';

ALTER TABLE driver_vehicles ADD COLUMN IF NOT EXISTS registration_date DATE;
