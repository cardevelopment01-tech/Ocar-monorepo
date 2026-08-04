-- ============================================================
-- City-wise dynamic rate cards
-- ------------------------------------------------------------
-- Rate cards are currently global: one row per (category, ride_type)
-- for the whole platform. Client wants per-city control from the
-- admin panel (Bhubaneswar/Cuttack/Puri may need different rates).
--
-- Reuses the exact NULL-fallback convention surge_events already
-- uses (surge_events.category_id IS NULL = applies to all categories
-- in that city): city_id IS NULL here means "global default, applies
-- to any city without its own override." No backfill needed — every
-- existing row becomes the global default automatically.
-- ============================================================

ALTER TABLE rate_cards
  ADD COLUMN city_id BIGINT NULL REFERENCES cities(id);

ALTER TABLE rate_card_history
  ADD COLUMN city_id BIGINT NULL REFERENCES cities(id);

COMMENT ON COLUMN rate_cards.city_id IS
  'NULL = global default rate, used by any city without its own override. Non-NULL = city-specific override, takes priority over the global row for that city.';

-- Replace the old (category_id, ride_type) unique index — NULL city_id
-- must still only allow ONE current global row per (category, ride_type),
-- and each real city must still only allow ONE current override per
-- (category, ride_type). Postgres treats NULL as distinct in a plain
-- unique index, so we coalesce it to a sentinel (0 — no real city has
-- this id) to actually enforce uniqueness across the NULL bucket too.
DROP INDEX rate_cards_current_idx;

CREATE UNIQUE INDEX rate_cards_current_idx
  ON rate_cards (COALESCE(city_id, 0), category_id, ride_type)
  WHERE effective_to IS NULL;

-- Lookup: "city override if it exists, else global" in one query,
-- ORDER BY city_id NULLS LAST LIMIT 1.
CREATE INDEX rate_cards_lookup_idx
  ON rate_cards (category_id, ride_type, city_id)
  WHERE effective_to IS NULL;
