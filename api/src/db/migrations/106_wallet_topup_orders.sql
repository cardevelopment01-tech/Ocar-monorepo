-- Durable record of every PayU wallet top-up order. The Redis binding
-- (wallet:topup_order:<txnid>, 24h TTL) stays as the fast path; this row is
-- what lets the reconcile sweep find a captured top-up whose webhook was
-- missed, and lets the funnel attribute a capture after the Redis key is gone.
CREATE TABLE wallet_topup_orders (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id      BIGINT NOT NULL REFERENCES drivers(id),
  gateway_txn_id VARCHAR(40) NOT NULL,
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'completed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX wallet_topup_orders_gateway_txn_uidx
  ON wallet_topup_orders (gateway_txn_id);

-- Reconcile sweep: pending rows by age. Literal comparison only (now() is not
-- IMMUTABLE and cannot appear in an index predicate).
CREATE INDEX wallet_topup_orders_pending_created_idx
  ON wallet_topup_orders (created_at) WHERE status = 'pending';
