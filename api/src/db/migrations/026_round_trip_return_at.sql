-- Add return_at to rides for round-trip bookings.
-- Stores the datetime the customer needs to be back — used for driver info and user receipts.
ALTER TABLE rides ADD COLUMN IF NOT EXISTS return_at TIMESTAMPTZ NULL;
