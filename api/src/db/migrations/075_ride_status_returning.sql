-- ============================================================
-- Round trip: distinct "returning" ride status
-- ------------------------------------------------------------
-- Round-trip rides previously had no way to represent "driver is now
-- heading back to the origin" — in_progress covered both the outbound
-- leg AND the whole return leg, all the way to instant completion.
-- This adds a status the driver explicitly triggers (a slider, same
-- UX pattern as "Slide to complete trip") once they start heading back.
-- Isolated in its own migration: ALTER TYPE ... ADD VALUE cannot be
-- used in the same transaction as anything that references the new
-- value (Postgres restriction), so nothing else goes in this file.
-- ============================================================

ALTER TYPE ride_status ADD VALUE 'returning';
