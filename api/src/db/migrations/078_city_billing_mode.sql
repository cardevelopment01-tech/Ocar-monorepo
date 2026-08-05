-- 078_city_billing_mode.sql
-- Per-city driver billing mode: 'commission' (existing flat % model, unchanged)
-- or 'package' (prepaid ride-value threshold, blocks new ride offers at zero).

CREATE TYPE city_billing_mode AS ENUM ('commission', 'package');

ALTER TABLE cities
  ADD COLUMN billing_mode city_billing_mode NOT NULL DEFAULT 'commission';

-- Admin-editable catalog of purchasable packages (price -> ride-value threshold).
CREATE TABLE package_tiers (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label           VARCHAR(100) NOT NULL,
  price           NUMERIC(10,2) NOT NULL CHECK (price > 0),
  threshold_value NUMERIC(10,2) NOT NULL CHECK (threshold_value > 0),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      BIGINT NULL REFERENCES admins(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per driver. Balance CAN go negative (a ride's final fare can exceed
-- the remaining threshold) — unlike driver_wallets, there is no balance >= 0
-- CHECK here on purpose. Negative balance just blocks the *next* ride offer.
CREATE TABLE driver_package_wallets (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id          BIGINT NOT NULL UNIQUE REFERENCES drivers(id),
  balance            NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_frozen          BOOLEAN NOT NULL DEFAULT false,
  frozen_reason      TEXT NULL,
  lifetime_topup     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (lifetime_topup >= 0),
  lifetime_consumed  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (lifetime_consumed >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE driver_package_ledger_entry_type AS ENUM
  ('topup', 'ride_consumption', 'admin_adjustment');

CREATE TABLE driver_package_ledger (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wallet_id     BIGINT NOT NULL REFERENCES driver_package_wallets(id),
  driver_id     BIGINT NOT NULL REFERENCES drivers(id),
  entry_type    driver_package_ledger_entry_type NOT NULL,
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  direction     VARCHAR(6) NOT NULL CHECK (direction IN ('credit', 'debit')),
  balance_after NUMERIC(12,2) NOT NULL,
  ride_id       BIGINT NULL REFERENCES rides(id),
  reference_id  VARCHAR(100) NULL,
  note          TEXT NULL,
  created_by    BIGINT NULL REFERENCES admins(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX driver_package_ledger_driver_idx ON driver_package_ledger (driver_id, created_at DESC);

CREATE INDEX driver_package_ledger_wallet_idx ON driver_package_ledger (wallet_id);

CREATE INDEX driver_package_ledger_ride_idx
  ON driver_package_ledger (ride_id)
  WHERE ride_id IS NOT NULL;

-- Razorpay orders for package purchases. Separate from `payments` because
-- `payments.ride_id`/`fare_snapshot_id` are NOT NULL and a package purchase
-- has neither.
CREATE TABLE package_purchase_orders (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id           BIGINT NOT NULL REFERENCES drivers(id),
  package_tier_id     BIGINT NOT NULL REFERENCES package_tiers(id),
  razorpay_order_id   VARCHAR(80) NULL UNIQUE,
  razorpay_payment_id VARCHAR(80) NULL UNIQUE,
  amount              NUMERIC(10,2) NOT NULL,
  threshold_value     NUMERIC(10,2) NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'completed', 'failed')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ NULL
);

CREATE INDEX package_purchase_orders_driver_idx ON package_purchase_orders (driver_id);

CREATE INDEX package_purchase_orders_package_tier_idx ON package_purchase_orders (package_tier_id);

-- Freezes which billing path a ride settles under, resolved once at
-- assignment time (see acceptAssignment in rides.repository.ts). NULL for
-- rides assigned before this migration ships; those settle via the existing
-- commission path unconditionally (see Task 8).
ALTER TABLE rides
  ADD COLUMN billing_mode_snapshot city_billing_mode NULL;

CREATE TRIGGER package_tiers_updated_at
  BEFORE UPDATE ON package_tiers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER driver_package_wallets_updated_at
  BEFORE UPDATE ON driver_package_wallets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
