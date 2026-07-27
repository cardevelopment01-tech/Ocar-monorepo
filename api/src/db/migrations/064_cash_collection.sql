-- 064: Driver cash collection — negative-capable wallet + ride cash-collection state.
-- Cash rides now settle on explicit driver confirmation (POST /rides/:id/collect-cash),
-- not automatically on end-OTP. Uncollected commission becomes a negative wallet
-- balance (= dues) which the existing goOnline min-balance gate already blocks on.

-- Signed balance: dropping the >= 0 floor turns "commission we couldn't collect"
-- into tracked dues instead of silently floored-at-zero revenue leakage.
ALTER TABLE driver_wallets DROP CONSTRAINT driver_wallets_balance_check;

-- Per-ride cash collection state. Null cash_collected_at = not yet confirmed.
ALTER TABLE rides
  ADD COLUMN cash_collected_amount NUMERIC(10,2) NULL,
  ADD COLUMN cash_collected_at     TIMESTAMPTZ   NULL,
  ADD COLUMN cash_discrepancy      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN cash_collection_note  TEXT          NULL;

-- Admin queue: rides needing ops review because collected != fare (or not collected).
CREATE INDEX rides_cash_discrepancy_idx
  ON rides (completed_at DESC)
  WHERE cash_discrepancy = true;

-- Config (system_config is key/value text; read via getConfigValue).
INSERT INTO system_config (key, value, description) VALUES
  ('cash_collection_enabled', 'true',
   'When true, cash rides require driver collection confirmation before settlement. Off = legacy auto-settle on end-OTP.'),
  ('cash_collection_tolerance', '1',
   'Rupee tolerance; |collected - fare| above this flags the ride as a cash discrepancy for ops.')
ON CONFLICT (key) DO NOTHING;
