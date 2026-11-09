-- 123_offers_config_seed.sql
-- Kill switches and the discount cap. All three offers flags default OFF: this migration changes no behaviour.
-- offers_max_discount_percent: driver-funded discounts must not leave a driver below a normal ride (review decision D23).
INSERT INTO system_config (key, value, value_type, is_public, description) VALUES
  ('offers_enabled', 'false', 'boolean', false, 'Master switch for coupons and offers. Off: no offer is previewed, applied or redeemed.'),
  ('offers_cash_discounts_enabled', 'false', 'boolean', false, 'Allow discounts on cash rides. Turn on only after the driver app is at the cash_due build and app_update_driver_android_min is raised.'),
  ('offers_cashback_enabled', 'false', 'boolean', false, 'Allow cashback-style offers. Keep off until the rider app can spend wallet credit.'),
  ('offers_max_discount_percent', '15', 'decimal', false, 'Largest percentage of the eligible fare any offer may take off. Driver-funded offers must not exceed the normal commission.')
ON CONFLICT (key) DO NOTHING;
