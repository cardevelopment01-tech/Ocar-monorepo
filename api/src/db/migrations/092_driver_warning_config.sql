-- §03.3: warning-escalation policy as system_config so ops can tune it live
-- (same mechanism as driver_minimum_balance / driver_payouts_enabled), no deploy.
INSERT INTO system_config (key, value, value_type, description) VALUES
  ('driver_warning_suspend_threshold', '3',  'integer', 'Warnings within the rolling window that trigger auto-suspension'),
  ('driver_warning_window_days',       '90', 'integer', 'Rolling window (days) for warning-count escalation')
ON CONFLICT (key) DO NOTHING;
