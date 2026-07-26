-- Several financial tables were missing the CHECK(>= 0) guards that already
-- exist on driver_wallets.balance/user_wallets.balance/*_ledger.amount/
-- refunds.amount. Verified against the live dev DB before writing this:
-- zero existing rows violate any of these constraints.
--
-- Not adding a check on driver_earnings.amount -- it is intentionally signed
-- (+/- for earnings vs deductions), a non-negative check would be wrong.

ALTER TABLE payments ADD CONSTRAINT payments_amount_nonneg CHECK (amount >= 0);
ALTER TABLE payments ADD CONSTRAINT payments_commission_amount_nonneg CHECK (commission_amount >= 0);
ALTER TABLE payments ADD CONSTRAINT payments_driver_earning_nonneg CHECK (driver_earning >= 0);

ALTER TABLE settlements ADD CONSTRAINT settlements_gross_earnings_nonneg CHECK (gross_earnings >= 0);
ALTER TABLE settlements ADD CONSTRAINT settlements_net_payout_nonneg CHECK (net_payout >= 0);
ALTER TABLE settlements ADD CONSTRAINT settlements_fee_nonneg CHECK (fee >= 0);

ALTER TABLE fare_snapshots ADD CONSTRAINT fare_snapshots_totals_nonneg
  CHECK (base_fare >= 0 AND distance_fare >= 0 AND time_fare >= 0 AND stop_fare >= 0
         AND total_estimated >= 0 AND total_final >= 0);

ALTER TABLE rate_card_history ADD CONSTRAINT rate_card_history_rates_nonneg
  CHECK (rate_per_km >= 0 AND rate_per_min >= 0 AND min_fare >= 0);

ALTER TABLE driver_wallets ADD CONSTRAINT driver_wallets_lifetime_nonneg
  CHECK (lifetime_topup >= 0 AND lifetime_commission >= 0);

ALTER TABLE tax_deductions ADD CONSTRAINT tax_deductions_amounts_nonneg
  CHECK (taxable_base >= 0 AND tds_amount >= 0);
