-- A surge with no city applies to every city (the default), the same NULL-fallback convention as rate_cards.city_id
-- and surge_events.category_id. A surge for one city overrides it there, so a city can also be exempted with 1.00x.
ALTER TABLE surge_events ALTER COLUMN city_id DROP NOT NULL;
