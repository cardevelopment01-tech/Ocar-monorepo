-- 125_offers_cash_guard_switch.sql
-- A deliberate switch for the cash-discount safety guard. Default 'true' = enforced = no behaviour change.
-- Set to 'false' only to let internal testers exercise cash discounts before the cash_due driver build is in production.
INSERT INTO system_config (key, value, value_type, is_public, description) VALUES
  ('offers_cash_guard_enforced', 'true', 'boolean', false, 'Safety guard for cash discounts. true: they need app_update_driver_android_min at the cash_due build. false: lifted, for internal testing only (a driver on an older app would be told to collect the undiscounted fare).')
ON CONFLICT (key) DO NOTHING;
