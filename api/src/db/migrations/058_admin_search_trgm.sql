-- Admin list endpoints (listDrivers/listAdminRides/listAdminUsers/listAdminPayments)
-- filter with ILIKE '%...%' (leading wildcard) on phone/full_name/code/name/email.
-- A leading wildcard can't use a plain btree index -- these seq-scan drivers/
-- users/rides/payments, exactly the tables growing fastest. pg_trgm GIN
-- indexes let ILIKE '%...%' use an index instead.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_drivers_phone_trgm ON drivers USING gin (phone gin_trgm_ops);
CREATE INDEX idx_drivers_full_name_trgm ON drivers USING gin (full_name gin_trgm_ops);
CREATE INDEX idx_drivers_code_trgm ON drivers USING gin (code gin_trgm_ops);
CREATE INDEX idx_users_name_trgm ON users USING gin (name gin_trgm_ops);
CREATE INDEX idx_users_phone_trgm ON users USING gin (phone gin_trgm_ops);
CREATE INDEX idx_users_email_trgm ON users USING gin (email gin_trgm_ops);
