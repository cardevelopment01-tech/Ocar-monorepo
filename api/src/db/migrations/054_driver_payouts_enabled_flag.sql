-- Kill switch for driver instant cash-out, defaulting off until RazorpayX
-- payouts are confirmed working end-to-end in an environment. Flip on with:
--   UPDATE system_config SET value = 'true' WHERE key = 'driver_payouts_enabled';
INSERT INTO system_config (key, value, value_type, description) VALUES
  ('driver_payouts_enabled', 'false', 'boolean', 'Enables driver-facing instant cash-out UI + endpoint. Keep false until RazorpayX payouts are confirmed working.');
