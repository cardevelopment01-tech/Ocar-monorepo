-- ============================================================
-- Cancellation fee, sourced from rate cards
-- ------------------------------------------------------------
-- The cancellation fee was computed in cancelRide but never charged
-- (always fee_amount = 0). Give it a real, city/category-scoped source
-- of truth on rate_cards, same versioning + NULL-city-fallback convention
-- as every other rate on this table (see migration 078). NULL = no fee
-- configured for that (city, category, ride_type) → treated as 0 by the app.
-- ============================================================

ALTER TABLE rate_cards
  ADD COLUMN cancellation_fee NUMERIC(8,2) NULL
    CHECK (cancellation_fee IS NULL OR cancellation_fee >= 0);

COMMENT ON COLUMN rate_cards.cancellation_fee IS
  'Flat fee charged to the rider when they cancel after a driver has been assigned. NULL = no fee (treated as 0). City/category-scoped like every other rate on this row.';

-- Backfill the current (effective_to IS NULL) rows with a sane starting default.
-- Admins tune per city/category later via the rate-card versioning flow (new row,
-- effective_to on the old one) — same as any other rate change.
-- ponytail: flat ₹50 placeholder across the board; real per-category values are a
-- rate-card admin action, not a code change.
UPDATE rate_cards
   SET cancellation_fee = 50.00
 WHERE effective_to IS NULL
   AND cancellation_fee IS NULL;
