-- Module: driver earnings ledger + payout (extends M08 payments/settlements)

-- ── NEW ENUMS ─────────────────────────────────────────────────
CREATE TYPE driver_earning_entry_type AS ENUM (
  'ride_fare_net', 'tip', 'incentive', 'cancellation_fee',
  'adjustment', 'tds_deduction', 'compliance_recovery'
);
CREATE TYPE driver_earning_status AS ENUM (
  'pending', 'cleared', 'on_hold', 'in_payout', 'paid', 'reversed', 'clawed_back'
);
CREATE TYPE bank_account_status AS ENUM (
  'pending_verification', 'verified', 'invalid'
);
CREATE TYPE settlement_run_type AS ENUM ('scheduled', 'instant');
CREATE TYPE payout_mode AS ENUM ('imps', 'upi', 'neft');

-- ── DRIVER BANK ACCOUNTS ──────────────────────────────────────
CREATE TABLE driver_bank_accounts (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id               BIGINT NOT NULL REFERENCES drivers(id),
  account_holder_name     VARCHAR(120) NOT NULL,
  account_number_enc      TEXT NOT NULL,
  ifsc                    VARCHAR(11) NOT NULL,
  upi_vpa                 VARCHAR(80) NULL,
  gateway_fund_account_id VARCHAR(80) NULL,
  status                  bank_account_status NOT NULL DEFAULT 'pending_verification',
  is_primary              BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX driver_bank_accounts_primary_idx
  ON driver_bank_accounts (driver_id) WHERE is_primary;

CREATE TRIGGER trg_driver_bank_accounts_updated_at
  BEFORE UPDATE ON driver_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── EXTEND EXISTING settlements (008_m6_payments.sql) ─────────
-- settlements is already a per-driver, per-period payout row with a
-- matching settlement_status enum (pending/processing/completed/failed/
-- on_hold) — reused as the payout state machine instead of a new table.
ALTER TABLE settlements
  ADD COLUMN run_type        settlement_run_type NOT NULL DEFAULT 'scheduled',
  ADD COLUMN bank_account_id BIGINT NULL REFERENCES driver_bank_accounts(id),
  ADD COLUMN fee             NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN mode            payout_mode NULL,
  ADD COLUMN utr             VARCHAR(40) NULL,
  ADD COLUMN approved_by     BIGINT NULL REFERENCES admins(id),
  ADD COLUMN approved_at     TIMESTAMPTZ NULL;

-- ── DRIVER EARNINGS LEDGER ────────────────────────────────────
-- Append-only. One row per financial event. Status transitions and
-- settlement linkage are the only mutable fields.
CREATE TABLE driver_earnings (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id       BIGINT NOT NULL REFERENCES drivers(id),
  ride_id         BIGINT NULL REFERENCES rides(id),
  payment_id      BIGINT NULL REFERENCES payments(id),
  entry_type      driver_earning_entry_type NOT NULL,
  amount          NUMERIC(12,2) NOT NULL, -- signed: credits +, deductions -
  status          driver_earning_status NOT NULL DEFAULT 'pending',
  available_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  settlement_id   BIGINT NULL REFERENCES settlements(id),
  idempotency_key VARCHAR(120) NOT NULL UNIQUE,
  note            TEXT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX driver_earnings_driver_status_idx
  ON driver_earnings (driver_id, status);
CREATE INDEX driver_earnings_settlement_idx
  ON driver_earnings (settlement_id) WHERE settlement_id IS NOT NULL;
CREATE INDEX driver_earnings_clearing_idx
  ON driver_earnings (available_at) WHERE status = 'pending';
CREATE TRIGGER trg_driver_earnings_updated_at
  BEFORE UPDATE ON driver_earnings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── PAYOUT HOLDS ──────────────────────────────────────────────
CREATE TABLE driver_payout_holds (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id  BIGINT NOT NULL REFERENCES drivers(id),
  reason     TEXT NOT NULL,
  placed_by  BIGINT NOT NULL REFERENCES admins(id),
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX driver_payout_holds_active_idx
  ON driver_payout_holds (driver_id) WHERE active;

-- ── TAX ───────────────────────────────────────────────────────
CREATE TABLE tax_deductions (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id        BIGINT NOT NULL REFERENCES drivers(id),
  ride_id          BIGINT NULL REFERENCES rides(id),
  settlement_id    BIGINT NULL REFERENCES settlements(id),
  section          VARCHAR(20) NOT NULL DEFAULT '194O',
  taxable_base     NUMERIC(12,2) NOT NULL,
  rate_pct         NUMERIC(5,2) NOT NULL,
  tds_amount       NUMERIC(12,2) NOT NULL,
  pan_at_deduction VARCHAR(10) NULL,
  fy               VARCHAR(9) NOT NULL,
  quarter          SMALLINT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tax_deductions_driver_fy_idx ON tax_deductions (driver_id, fy);

CREATE TABLE driver_tax_profile (
  driver_id    BIGINT PRIMARY KEY REFERENCES drivers(id),
  pan_enc      TEXT NULL,
  pan_verified BOOLEAN NOT NULL DEFAULT false,
  gstin        VARCHAR(15) NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_driver_tax_profile_updated_at
  BEFORE UPDATE ON driver_tax_profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── CONFIG ────────────────────────────────────────────────────
INSERT INTO system_config (key, value, value_type, description) VALUES
  ('payout_hold_hours',        '24',  'integer', 'Hours before a cleared earning becomes payable (T+N settlement hold)'),
  ('tds_rate_with_pan_pct',    '1',   'decimal', '194-O TDS rate when driver PAN is verified'),
  ('tds_rate_without_pan_pct', '20',  'decimal', '194-O TDS rate when driver PAN is not verified/on file'),
  ('instant_payout_fee',       '10',  'decimal', 'Flat fee (INR) for driver-initiated instant cash-out'),
  ('settlement_auto_approve_limit', '50000', 'decimal', 'Batch total (INR) below which a scheduled settlement run auto-advances to processing');
