-- 151_package_gst_and_expiry.sql
-- Driver ride-credit packages (billing_mode = 'package'): GST on the purchase and a 365-day life for every purchase.
--
--  * GST is ADDED to the package price (price 40 -> 7.20 GST -> driver pays 47.20 and gets the full ride value, e.g. 550).
--    package_purchase_orders.amount stays what the gateway charged (the total, so PayU's captured amount still matches it);
--    price_amount / gst_percent / gst_amount record how that total splits. Orders made before this migration keep gst 0.
--  * Each purchase is its own credit "lot" with its own expiry (package_credit_lots). Fares use up the lot that expires first;
--    what is left of a lot when it expires lapses (ledger entry 'expiry', no refund). Balances that existed before this migration
--    are in no lot and never expire.
--  * Plans are per vehicle group (cab or auto): a driver is shown only their own group's plans.
SET LOCAL lock_timeout = '10s';

ALTER TABLE package_tiers
  ADD COLUMN IF NOT EXISTS vehicle_group TEXT NOT NULL DEFAULT 'cab',
  ADD COLUMN IF NOT EXISTS validity_days INTEGER NOT NULL DEFAULT 365;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'package_tiers_vehicle_group_check') THEN
    ALTER TABLE package_tiers ADD CONSTRAINT package_tiers_vehicle_group_check CHECK (vehicle_group IN ('cab', 'auto'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'package_tiers_validity_days_check') THEN
    ALTER TABLE package_tiers ADD CONSTRAINT package_tiers_validity_days_check CHECK (validity_days BETWEEN 1 AND 3650);
  END IF;
END $$;

ALTER TABLE package_purchase_orders
  ADD COLUMN IF NOT EXISTS price_amount  NUMERIC(10,2) NULL,
  ADD COLUMN IF NOT EXISTS gst_percent   NUMERIC(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validity_days INTEGER       NOT NULL DEFAULT 365;
COMMENT ON COLUMN package_purchase_orders.amount IS 'What the driver is charged (price + GST). The gateway''s captured amount is checked against this.';
COMMENT ON COLUMN package_purchase_orders.price_amount IS 'The package price before GST. NULL on orders made before GST was added (amount was the price).';

INSERT INTO system_config (key, value, value_type, description)
VALUES ('package_gst_percent', '18', 'decimal', 'GST added on top of a driver package price at purchase (percent).')
ON CONFLICT (key) DO NOTHING;

-- Ledger: lapsed value is its own entry type.
ALTER TYPE driver_package_ledger_entry_type ADD VALUE IF NOT EXISTS 'expiry';

CREATE TABLE IF NOT EXISTS package_credit_lots (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wallet_id   BIGINT NOT NULL REFERENCES driver_package_wallets(id),
  driver_id   BIGINT NOT NULL REFERENCES drivers(id),
  order_id    BIGINT NULL REFERENCES package_purchase_orders(id),
  credited    NUMERIC(12,2) NOT NULL CHECK (credited > 0),
  remaining   NUMERIC(12,2) NOT NULL CHECK (remaining >= 0),
  expires_at  TIMESTAMPTZ NOT NULL,
  expired_at  TIMESTAMPTZ NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (remaining <= credited)
);
-- The live lots of a driver, soonest expiry first (what a fare draws from, and what the expiry sweep walks).
CREATE INDEX IF NOT EXISTS package_credit_lots_live_idx ON package_credit_lots (driver_id, expires_at) WHERE expired_at IS NULL AND remaining > 0;
CREATE INDEX IF NOT EXISTS package_credit_lots_due_idx ON package_credit_lots (expires_at) WHERE expired_at IS NULL AND remaining > 0;
