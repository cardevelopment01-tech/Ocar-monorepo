-- Advance bookings: reschedule count, a "still searching" window, and the policy settings an admin edits on the Dispatch desk.
-- Additive only: the previous release ignores the new columns and keys.

ALTER TABLE ride_advance_meta
  ADD COLUMN IF NOT EXISTS reschedule_count  SMALLINT    NOT NULL DEFAULT 0,
  -- While set and in the future, the dispatch watchdogs leave the ride alone: it is deliberately still searching after its first rounds found nobody.
  ADD COLUMN IF NOT EXISTS search_until      TIMESTAMPTZ NULL,
  -- When ops and the rider were first told the first rounds found nobody (so it happens once per ride, not once per retry).
  ADD COLUMN IF NOT EXISTS search_alerted_at TIMESTAMPTZ NULL;

INSERT INTO system_config (key, value, value_type, description) VALUES
  ('advance_late_cancel_enabled',     'false',   'boolean', 'Charge a fee when a rider cancels an advance booking close to pickup after a driver has accepted it.'),
  ('advance_late_cancel_window_min',  '60',      'integer', 'A cancellation this many minutes or fewer before pickup is a late cancellation (0 to 1440).'),
  ('advance_late_cancel_fee_mode',    'percent', 'string',  'How the late-cancel fee is worked out: percent (of the fare, up to the cap) or flat (a fixed amount).'),
  ('advance_late_cancel_fee_percent', '10',      'decimal', 'Late-cancel fee as a percent of the fare when the mode is percent (0 to 100).'),
  ('advance_late_cancel_fee_cap',     '100',     'decimal', 'Most a percent-based late-cancel fee can be, in rupees (0 to 5000).'),
  ('advance_late_cancel_fee_flat',    '50',      'decimal', 'Late-cancel fee in rupees when the mode is flat (0 to 5000).'),
  ('advance_reschedule_max',          '3',       'integer', 'How many times a rider can change the pickup time of one advance booking (0 to 10).'),
  ('advance_search_grace_min',        '10',      'integer', 'If no driver is found at dispatch, keep searching until this many minutes after the pickup time (0 to 60; 0 = give up at once).')
ON CONFLICT (key) DO NOTHING;
