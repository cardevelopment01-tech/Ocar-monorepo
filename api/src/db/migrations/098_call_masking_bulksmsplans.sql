-- Call masking switched vendors from Exotel (never activated — see 085's
-- exotel_* keys, left in place but now unused) to bulksmsplans, the same
-- vendor already used for SMS. bulksmsplans has one shared IVR number for
-- the whole account rather than a rented number pool, so there's no
-- per-ride allocation/expiry concept to configure — just an enable switch,
-- a per-ride call cap, and a live-credit floor (bulksmsplans has no
-- push-based spend webhook, so the floor is checked by polling
-- check_ivr_credit rather than tallying spend like the old exotel_daily_budget_inr).

INSERT INTO system_config (key, value, value_type, description, is_public) VALUES
  ('call_masking_enabled', 'false', 'boolean', 'Kill switch for masked calling — off until bulksmsplans IVR credit is loaded and verified end-to-end', false),
  ('call_masking_max_calls_per_ride', '10', 'integer', 'Max masked-call attempts allowed per ride, to blunt repeat-dial abuse', false),
  ('call_masking_credit_floor', '500', 'integer', 'IVR credit balance floor — dropping below it disables masking until an admin re-enables it', false);
