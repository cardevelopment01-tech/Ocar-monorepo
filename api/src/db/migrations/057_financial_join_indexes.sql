-- Financial reconciliation joins (ledger/settlement lookups by ride or
-- payment) are unindexed on tables that grow on nearly every completed ride.
-- Same reasoning as 056: plain CREATE INDEX, matches existing convention.

CREATE INDEX idx_driver_wallet_ledger_driver_id ON driver_wallet_ledger(driver_id);
CREATE INDEX idx_driver_earnings_ride_id ON driver_earnings(ride_id);
CREATE INDEX idx_driver_earnings_payment_id ON driver_earnings(payment_id);
CREATE INDEX idx_fare_snapshots_rate_card_id ON fare_snapshots(rate_card_id);
CREATE INDEX idx_fare_snapshots_rental_package_id ON fare_snapshots(rental_package_id);
CREATE INDEX idx_fare_snapshots_surge_event_id ON fare_snapshots(surge_event_id);
CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_fare_snapshot_id ON payments(fare_snapshot_id);
CREATE INDEX idx_tax_deductions_settlement_id ON tax_deductions(settlement_id);
