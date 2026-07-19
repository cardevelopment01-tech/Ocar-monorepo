-- Ride-fare online payment (M08 checkout): rider picks how to pay at booking.
-- Small fixed-value column → VARCHAR + CHECK (same pattern as the `direction`
-- columns in 011_wallet.sql), default 'cash' so every existing row is unchanged.
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS payment_channel VARCHAR(10) NOT NULL DEFAULT 'cash'
  CHECK (payment_channel IN ('cash', 'online', 'wallet'));

-- payments.channel is the payment_channel enum; add a distinct value for a
-- Razorpay-collected ride fare (existing values are cash/QR/wallet variants).
ALTER TYPE payment_channel ADD VALUE IF NOT EXISTS 'razorpay_online';
