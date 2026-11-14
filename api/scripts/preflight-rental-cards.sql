-- Preflight for the City ride work (plan: docs/superpowers/plans/2026-11-12-city-ride-separation.md, Task 1).
-- READ-ONLY. Run on every environment before migration 136 is deployed:
--   psql "$DATABASE_URL" -f api/scripts/preflight-rental-cards.sql
-- Expected result: 0 rows.
-- Each row is an active rental package whose category has no current rental rate card (neither a city override
-- nor a global one). Migration 136 copies the stop charge and cancellation fee from that card onto the package;
-- for a row listed here it cannot, and the package fees stay 0 until an admin sets them.
SELECT rp.id AS package_id,
       rp.category_id,
       rp.city_id,
       rp.duration_minutes,
       rp.km_limit
FROM rental_packages rp
WHERE rp.is_active
  AND NOT EXISTS (
    SELECT 1
    FROM rate_cards rc
    WHERE rc.category_id = rp.category_id
      AND rc.ride_type = 'rental'
      AND rc.effective_to IS NULL
      AND (rc.city_id = rp.city_id OR rc.city_id IS NULL)
  )
ORDER BY rp.category_id, rp.city_id NULLS FIRST, rp.duration_minutes;
