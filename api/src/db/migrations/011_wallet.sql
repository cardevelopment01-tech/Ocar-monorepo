-- Module M08: driver and user wallet tables
-- Enums defined in 002_enums.sql:
--   driver_wallet_entry_type, user_wallet_entry_type, wallet_entry_status

-- ── DRIVER WALLETS ────────────────────────────────────────────
-- Compliance deposit account. Commission is deducted here after
-- each ride. Must stay above minimum_balance to accept rides.
CREATE TABLE driver_wallets (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id           BIGINT NOT NULL UNIQUE REFERENCES drivers(id),
  balance             NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  lifetime_topup      NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  lifetime_commission NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  is_frozen           BOOLEAN NOT NULL DEFAULT false,
  frozen_reason       TEXT NULL,
  frozen_by           BIGINT NULL REFERENCES admins(id),
  frozen_at           TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_driver_wallets_updated_at
  BEFORE UPDATE ON driver_wallets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── DRIVER WALLET LEDGER ──────────────────────────────────────
-- Immutable transaction log. Never UPDATE or DELETE rows.
CREATE TABLE driver_wallet_ledger (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wallet_id     BIGINT NOT NULL REFERENCES driver_wallets(id),
  driver_id     BIGINT NOT NULL REFERENCES drivers(id),
  entry_type    driver_wallet_entry_type NOT NULL,
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  direction     VARCHAR(6) NOT NULL CHECK (direction IN ('credit', 'debit')),
  balance_after NUMERIC(12,2) NOT NULL,
  ride_id       BIGINT NULL REFERENCES rides(id),
  reference_id  VARCHAR(80) NULL,
  note          TEXT NULL,
  status        wallet_entry_status NOT NULL DEFAULT 'completed',
  created_by    BIGINT NULL REFERENCES admins(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX driver_wallet_ledger_wallet_idx
  ON driver_wallet_ledger (wallet_id, created_at DESC);

CREATE INDEX driver_wallet_ledger_ride_idx
  ON driver_wallet_ledger (ride_id)
  WHERE ride_id IS NOT NULL;

-- ── USER WALLETS ──────────────────────────────────────────────
-- Cashback and referral credits only.
-- Phase 2: allow balance to pay for rides.
CREATE TABLE user_wallets (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         BIGINT NOT NULL UNIQUE REFERENCES users(id),
  balance         NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  lifetime_earned NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  lifetime_spent  NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_user_wallets_updated_at
  BEFORE UPDATE ON user_wallets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── USER WALLET LEDGER ────────────────────────────────────────
CREATE TABLE user_wallet_ledger (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wallet_id     BIGINT NOT NULL REFERENCES user_wallets(id),
  user_id       BIGINT NOT NULL REFERENCES users(id),
  entry_type    user_wallet_entry_type NOT NULL,
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  direction     VARCHAR(6) NOT NULL CHECK (direction IN ('credit', 'debit')),
  balance_after NUMERIC(12,2) NOT NULL,
  ride_id       BIGINT NULL REFERENCES rides(id),
  expires_at    TIMESTAMPTZ NULL,
  note          TEXT NULL,
  status        wallet_entry_status NOT NULL DEFAULT 'completed',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX user_wallet_ledger_wallet_idx
  ON user_wallet_ledger (wallet_id, created_at DESC);

CREATE INDEX user_wallet_ledger_expiry_idx
  ON user_wallet_ledger (expires_at)
  WHERE expires_at IS NOT NULL AND status = 'completed';
