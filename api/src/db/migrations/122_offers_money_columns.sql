-- 122_offers_money_columns.sql
-- Discount columns and the single SQL definition of what the rider pays (plan Task 1, review decision D7).
-- fare_snapshots keeps the GROSS fare in total_*; payments.amount will become the payable in PR2.
-- Both ADD COLUMNs carry a constant DEFAULT, so no table is rewritten.
ALTER TABLE fare_snapshots ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE payments       ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION ocar_payable(gross numeric, discount numeric) RETURNS numeric
  LANGUAGE sql IMMUTABLE AS $$ SELECT GREATEST(gross - COALESCE(discount, 0), 0) $$;
