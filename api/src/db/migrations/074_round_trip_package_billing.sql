-- ============================================================
-- Round-trip package billing (guaranteed-minimum km/day + driver allowance)
-- ------------------------------------------------------------
-- Current round_trip pricing is: (one_way_km × 2) × rate_per_km + booked
-- trip_hours × hour_rate, computed ONCE at booking time and never
-- reconciled against what was actually driven — rides.service.ts's
-- verifyEndOTP falls back to total_estimated for every normal round-trip
-- completion. This does not match how outstation cabs are billed
-- industry-wide (Ola Outstation / Uber Intercity / Savaari): a guaranteed
-- minimum km allowance per day, extra km beyond it charged at the same
-- per-km rate, and a flat per-day driver allowance (food/stay) — recalculated
-- against ACTUAL days/km at trip completion.
-- ============================================================

ALTER TABLE rate_cards
  ADD COLUMN km_per_day               NUMERIC(6,2) NULL
    CHECK (km_per_day IS NULL OR km_per_day > 0),
  ADD COLUMN driver_allowance_per_day NUMERIC(8,2) NULL
    CHECK (driver_allowance_per_day IS NULL OR driver_allowance_per_day >= 0);

COMMENT ON COLUMN rate_cards.km_per_day IS
  'round_trip only: guaranteed-minimum km billed per day (e.g. 250 for sedan). NULL for one_way/rental.';
COMMENT ON COLUMN rate_cards.driver_allowance_per_day IS
  'round_trip only: flat per-day driver bata (food/stay). Replaces the old hour_rate × trip_hours model. NULL for one_way/rental.';
COMMENT ON COLUMN rate_cards.hour_rate IS
  'DEPRECATED for round_trip as of 074 — kept only so historical fare_snapshots/rate_card_history rows remain reconstructable. New round_trip pricing uses km_per_day + driver_allowance_per_day instead.';

ALTER TABLE rate_card_history
  ADD COLUMN km_per_day               NUMERIC(6,2) NULL,
  ADD COLUMN driver_allowance_per_day NUMERIC(8,2) NULL;

-- Backfill existing round_trip rate cards with a starting package config so
-- pricing doesn't silently zero out post-migration. These are placeholder
-- defaults (250 km/day, ₹300/day) — an admin must tune them per category via
-- the rate-cards page (Task 6) before this goes live for real bookings.
--
-- One-time schema-bootstrap exception to the "never UPDATE rate_cards" rule
-- (006_m4_pricing.sql): these two columns are brand new (were NULL, not a
-- prior versioned value), so there is no rate_card_history entry to preserve.
-- Do NOT copy this UPDATE pattern for actual pricing changes — those must go
-- through createRateCard's expire-old-row + INSERT new-row cycle.
UPDATE rate_cards
SET km_per_day = 250, driver_allowance_per_day = 300
WHERE ride_type = 'round_trip' AND effective_to IS NULL;
