-- PayU collections: gateway-neutral columns alongside the legacy razorpay_* ones.
-- Additive only — Razorpay history (and in-flight payments) must stay readable.

-- Used by rides.service.settleRideCompletionPayment for PayU-collected fares.
-- (Not referenced in this migration, so ADD VALUE inside the txn is fine — same as 047.)
ALTER TYPE payment_channel ADD VALUE IF NOT EXISTS 'payu_online';

ALTER TABLE payments
  ADD COLUMN gateway            VARCHAR(16) NULL,
  ADD COLUMN gateway_txn_id     VARCHAR(40) NULL,
  ADD COLUMN gateway_payment_id VARCHAR(40) NULL;

CREATE UNIQUE INDEX payments_gateway_txn_uidx
  ON payments (gateway_txn_id) WHERE gateway_txn_id IS NOT NULL;
CREATE UNIQUE INDEX payments_gateway_payment_uidx
  ON payments (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;

ALTER TABLE package_purchase_orders
  ADD COLUMN gateway            VARCHAR(16) NULL,
  ADD COLUMN gateway_txn_id     VARCHAR(40) NULL,
  ADD COLUMN gateway_payment_id VARCHAR(40) NULL;

CREATE UNIQUE INDEX package_purchase_orders_gateway_txn_uidx
  ON package_purchase_orders (gateway_txn_id) WHERE gateway_txn_id IS NOT NULL;
CREATE UNIQUE INDEX package_purchase_orders_gateway_payment_uidx
  ON package_purchase_orders (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;

-- Dedup key for PayU notifications: `${mihpayid}:${unmappedstatus}`.
-- event_type reuses the existing payment_captured / payment_failed values.
ALTER TABLE payment_gateway_events
  ADD COLUMN gateway_event_id VARCHAR(80) NULL;
CREATE UNIQUE INDEX payment_gateway_events_gateway_event_uidx
  ON payment_gateway_events (gateway_event_id) WHERE gateway_event_id IS NOT NULL;
