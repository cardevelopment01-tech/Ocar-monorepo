-- Kill switch for the driver app's in-app PayU payments (wallet top-ups and package purchases).
-- Read via getConfigValue('mobile_payments_enabled', 'false') in payments/payu-sdk.ts. It had no
-- migration, so the row only existed where someone ran SQL by hand and the admin System config page
-- had nothing to show. Creating it here makes it a switch on that page (apps/admin/lib/system-config-model.ts).
-- Default OFF; DO NOTHING keeps whatever value an environment already has.
INSERT INTO system_config (key, value, description) VALUES
  ('mobile_payments_enabled', 'false',
   'Driver app in-app PayU payments (wallet top-ups, package purchases). Off refuses new orders and hash signing; confirmation of in-flight payments keeps working.')
ON CONFLICT (key) DO NOTHING;
