-- 138_city_rides_flag.sql
-- City ride work, Phase B (plan: docs/superpowers/plans/2026-11-12-city-ride-separation.md, Task 6).
-- Kill switch for the metered in-city mode. OFF: the trip classifier never offers a city ride and a booking that asks for one is
-- refused, so this migration changes no behaviour. Turn on per environment once Gate C passes.
INSERT INTO system_config (key, value, value_type, is_public, description) VALUES
  ('city_rides_enabled', 'false', 'boolean', false, 'Allow the City ride mode (metered, point to point inside one city boundary). Off: classify-trip never offers it and a city booking is refused with CITY_RIDE_DISABLED.')
ON CONFLICT (key) DO NOTHING;
