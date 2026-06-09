-- Module M08: payments, gateway events, settlements, refunds
-- Enums defined in 002_enums.sql:
--   payment_channel, payment_status, gateway_event_type,
--   settlement_status, refund_status

-- ── PAYMENTS ──────────────────────────────────────────────────
CREATE TABLE payments (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id              BIGINT NOT NULL UNIQUE REFERENCES rides(id),
  user_id              BIGINT NOT NULL REFERENCES users(id),
  driver_id            BIGINT NOT NULL REFERENCES drivers(id),
  fare_snapshot_id     BIGINT NOT NULL REFERENCES fare_snapshots(id),
  razorpay_order_id    VARCHAR(80) UNIQUE NULL,
  razorpay_payment_id  VARCHAR(80) UNIQUE NULL,
  amount               NUMERIC(12,2) NOT NULL,
  currency             VARCHAR(3) NOT NULL DEFAULT 'INR',
  channel              payment_channel NOT NULL,
  status               payment_status NOT NULL DEFAULT 'pending',
  commission_percent   NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  commission_amount    NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  driver_earning       NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  captured_at          TIMESTAMPTZ NULL,
  failed_at            TIMESTAMPTZ NULL,
  failure_reason       TEXT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payments_ride_idx ON payments (ride_id);
CREATE INDEX payments_status_idx ON payments (status, created_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX payments_driver_idx ON payments (driver_id, created_at DESC);

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── PAYMENT GATEWAY EVENTS ────────────────────────────────────
-- Immutable Razorpay webhook log for reconciliation.
CREATE TABLE payment_gateway_events (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id          BIGINT NULL REFERENCES payments(id),
  event_type          gateway_event_type NOT NULL,
  razorpay_event_id   VARCHAR(80) UNIQUE NULL,
  payload             JSONB NOT NULL,
  processed           BOOLEAN NOT NULL DEFAULT false,
  processed_at        TIMESTAMPTZ NULL,
  error               TEXT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pge_payment_idx
  ON payment_gateway_events (payment_id, created_at);
CREATE INDEX pge_unprocessed_idx
  ON payment_gateway_events (created_at)
  WHERE processed = false;

-- ── SETTLEMENTS ───────────────────────────────────────────────
-- Periodic batch payout to drivers. Admin-triggered in Phase 1.
CREATE TABLE settlements (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id            BIGINT NOT NULL REFERENCES drivers(id),
  period_from          DATE NOT NULL,
  period_to            DATE NOT NULL,
  total_rides          INTEGER NOT NULL DEFAULT 0,
  gross_earnings       NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  commission_total     NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  net_payout           NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  status               settlement_status NOT NULL DEFAULT 'pending',
  razorpay_payout_id   VARCHAR(80) NULL,
  bank_account_ref     VARCHAR(80) NULL,
  notes                TEXT NULL,
  initiated_by         BIGINT NULL REFERENCES admins(id),
  initiated_at         TIMESTAMPTZ NULL,
  completed_at         TIMESTAMPTZ NULL,
  failed_at            TIMESTAMPTZ NULL,
  failure_reason       TEXT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX settlements_driver_idx
  ON settlements (driver_id, period_from DESC);
CREATE INDEX settlements_status_idx
  ON settlements (status, created_at)
  WHERE status IN ('pending', 'processing');

CREATE TRIGGER trg_settlements_updated_at
  BEFORE UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── REFUNDS ───────────────────────────────────────────────────
CREATE TABLE refunds (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id           BIGINT NOT NULL REFERENCES payments(id),
  ride_id              BIGINT NOT NULL REFERENCES rides(id),
  dispute_id           BIGINT NULL,
  -- FK to disputes added in M09 migration
  amount               NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason               TEXT NOT NULL,
  status               refund_status NOT NULL DEFAULT 'requested',
  refund_destination   VARCHAR(20) NOT NULL DEFAULT 'original',
  razorpay_refund_id   VARCHAR(80) UNIQUE NULL,
  initiated_by         BIGINT NULL REFERENCES admins(id),
  approved_by          BIGINT NULL REFERENCES admins(id),
  approved_at          TIMESTAMPTZ NULL,
  processed_at         TIMESTAMPTZ NULL,
  failed_at            TIMESTAMPTZ NULL,
  failure_reason       TEXT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refunds_payment_idx ON refunds (payment_id);
CREATE INDEX refunds_status_idx ON refunds (status, created_at)
  WHERE status IN ('requested', 'approved', 'processing');

CREATE TRIGGER trg_refunds_updated_at
  BEFORE UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
