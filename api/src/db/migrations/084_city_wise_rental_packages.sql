-- ============================================================
-- City-wise rental package pricing
-- ------------------------------------------------------------
-- rental_packages is currently global: one row per (category,
-- duration_minutes, km_limit) for the whole platform. Client
-- wants per-city control from the admin panel, same as
-- rate_cards (078_city_wise_rate_cards.sql).
--
-- Reuses the exact NULL-fallback convention: city_id IS NULL
-- means "global default, applies to any city without its own
-- override for this tier." No backfill needed — every existing
-- row becomes the global default automatically.
--
-- Unlike rate_cards, rental_packages is NOT versioned (no
-- effective_to/history table) — admin CRUD does direct
-- UPDATE/DELETE/INSERT, so city_id is just another column.
-- ============================================================

ALTER TABLE rental_packages
  ADD COLUMN city_id BIGINT NULL REFERENCES cities(id);

COMMENT ON COLUMN rental_packages.city_id IS
  'NULL = global default package tier, used by any city without its own override for this (category, duration, km) tier. Non-NULL = city-specific override, wins over the global row for the same tier.';

-- 030_rental_package_flexibility.sql named this constraint explicitly,
-- so drop by literal name (no DO-block needed, unlike its own drop of
-- the anonymous CHECK it replaced).
ALTER TABLE rental_packages
  DROP CONSTRAINT rental_packages_category_duration_km_key;

-- COALESCE(city_id, 0) so the NULL (global) bucket is uniqueness-enforced
-- too, mirroring rate_cards_current_idx from 078. Must be a plain unique
-- INDEX (not a table CONSTRAINT) because constraints can't use expressions.
CREATE UNIQUE INDEX rental_packages_category_duration_km_idx
  ON rental_packages (category_id, duration_minutes, km_limit, COALESCE(city_id, 0));

-- "List packages for category X, city Y" — city override if it exists,
-- else global, resolved in application SQL (see Task 3, not part of this task).
CREATE INDEX rental_packages_city_lookup_idx
  ON rental_packages (category_id, city_id)
  WHERE is_active = true;
