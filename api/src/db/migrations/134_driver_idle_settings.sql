-- Idle driver sweep settings (cleanup worker). Additive; defaults match the code. Read live (cached ~30 s), edited in the admin config page.
INSERT INTO system_config (key, value, value_type, description) VALUES
  ('driver_idle_pause_seconds', '90', 'number',
   'Seconds a driver may be silent (no location, heartbeat or live connection) before they are paused and stop getting offers. 30-900.'),
  ('driver_idle_offline_minutes', '60', 'number',
   'Minutes a driver may be silent before their online session ends and they are told they went offline. 5-240.')
ON CONFLICT (key) DO NOTHING;
