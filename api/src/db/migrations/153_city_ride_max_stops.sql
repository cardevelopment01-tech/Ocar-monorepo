-- A city ride may have at most this many stops (the client's rule is 2). Other ride types keep the global limit.
INSERT INTO system_config (key, value, value_type, description)
VALUES ('city_ride_max_stops', '2', 'integer', 'Most stops a city ride can have (0 to 3). Stops must also lie inside the city boundary.')
ON CONFLICT (key) DO NOTHING;
