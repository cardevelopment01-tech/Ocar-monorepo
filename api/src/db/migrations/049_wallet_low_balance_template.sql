-- Driver wallet dropped below the minimum required balance after a
-- commission deduction — notify the driver to recharge (see deductCommission
-- in payments.service.ts). Push-only, same pattern as payment_failed in 048.
INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema) VALUES
  ('wallet_low_balance', 'Driver wallet below minimum balance (SMS)', 'sms', NULL,
   'Ocar: Your wallet balance is ₹{{balance}}, below the ₹{{minBalance}} minimum required to receive rides. Recharge now to keep receiving rides.',
   '{"required": ["balance", "minBalance"], "optional": []}'),

  ('wallet_low_balance', 'Driver wallet below minimum balance (push)', 'push', 'Wallet balance low',
   'Your wallet balance is ₹{{balance}}, below the ₹{{minBalance}} minimum. Recharge to keep receiving rides.',
   '{"required": ["balance", "minBalance"], "optional": []}');
