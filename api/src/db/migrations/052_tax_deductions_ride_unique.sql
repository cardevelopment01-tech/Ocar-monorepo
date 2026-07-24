-- Idempotency guard for accrueDriverEarning's tax_deductions insert:
-- a re-invoked accrual for the same ride must not double-insert a tax record.
CREATE UNIQUE INDEX tax_deductions_ride_idx ON tax_deductions (ride_id) WHERE ride_id IS NOT NULL;
