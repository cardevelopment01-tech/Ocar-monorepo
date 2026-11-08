-- Why did (or didn't) each driver near a pickup get this ride? Phase 0 of docs/superpowers/plans/2026-11-08-dispatch-spread-to-more-drivers.md.
-- READ ONLY: one transaction opened READ ONLY, SELECT statements only. Safe to run on a copy or, with approval, through the read-only tunnel.
--
-- Run: psql "$DATABASE_URL" -v ride_id=191 [-v radius_km=15] -f api/scripts/ride-offer-diagnostic.sql
--
-- It mirrors findNearbyDrivers (api/src/modules/rides/rides.repository.ts) and the round rules in broadcast.processor.ts, but as of NOW:
-- the driver positions, sessions, wallets and documents it reads are today's, not the ride's moment. For a ride that is older than a few
-- minutes, read the "offers" section (what really happened) first and treat the "candidates" section as "who would match today".
--
-- Output sections:
--   1. the ride, and the radius and category rules it was matched with
--   2. the offers this ride really had (every assignment row, in order). expiry_was_moved = true means a later round re-sent a still-open
--      offer and pushed its expiry out (a window longer than the 20 s / 45 s maximum is the tell-tale; offered_at keeps the FIRST offer time)
--   3. candidates: every driver with a position snapshot inside the radius, with a plain-language reason for each filter, and what
--      happened to them (offer status), nearest first
-- No phone numbers are printed (driver id only).

\set ON_ERROR_STOP on
\if :{?radius_km}
\else
  \set radius_km 15
\endif
\if :{?ride_id}
\else
  \echo 'usage: psql ... -v ride_id=<id> [-v radius_km=15] -f ride-offer-diagnostic.sql'
  \quit
\endif

BEGIN READ ONLY;

\echo '== 1. The ride'
SELECT r.id, r.status::text, r.ride_type::text, r.category_id,
       (SELECT display_name FROM vehicle_categories WHERE id = r.category_id) AS category,
       r.requested_at,
       ST_Y(r.origin::geometry) AS pickup_lat, ST_X(r.origin::geometry) AS pickup_lng,
       r.origin_city_id,
       (SELECT string_agg(f.category_id::text, ',') FROM category_fallback_rules f WHERE f.accepts_category_id = r.category_id) AS fallback_category_ids_from_round_2
  FROM rides r WHERE r.id = :ride_id;

\echo
\echo '== 2. Offers this ride really had (oldest first)'
SELECT a.id AS assignment, a.driver_id, a.broadcast_round AS round, a.status::text,
       a.offered_at, a.expires_at,
       round(extract(epoch FROM (a.expires_at - a.offered_at))::numeric) AS window_s,
       (extract(epoch FROM (a.expires_at - a.offered_at)) > 46) AS expiry_was_moved,
       a.responded_at,
       CASE WHEN a.responded_at IS NOT NULL THEN round(extract(epoch FROM (a.responded_at - a.offered_at))::numeric, 1) END AS answered_after_s,
       round(a.driver_lat::numeric, 4) AS lat_when_offered, round(a.driver_lng::numeric, 4) AS lng_when_offered
  FROM ride_assignments a WHERE a.ride_id = :ride_id
 ORDER BY a.offered_at, a.id;

\echo
\echo '== 3. Candidates: every driver with a position within the radius (default 15 km), nearest first'
\echo '   (matched = would pass every filter of findNearbyDrivers today; reason = the first filter that fails)'
WITH ride AS (
  SELECT r.id, r.category_id, r.origin FROM rides r WHERE r.id = :ride_id
), min_balance AS (
  SELECT COALESCE((SELECT value::numeric FROM system_config WHERE key = 'driver_minimum_balance'), 500) AS v
), cats AS (
  SELECT (SELECT category_id FROM ride) AS id
  UNION
  SELECT f.category_id FROM category_fallback_rules f WHERE f.accepts_category_id = (SELECT category_id FROM ride)
), cand AS (
  SELECT dls.driver_id, dls.session_id, dls.is_available, dls.updated_at AS snapshot_updated, dls.recorded_at AS position_recorded,
         ST_Distance(dls.location, (SELECT origin FROM ride)) / 1000.0 AS straight_km
    FROM driver_location_snapshots dls
   WHERE ST_DWithin(dls.location, (SELECT origin FROM ride), (:'radius_km')::float8 * 1000)
), facts AS (
  SELECT c.*, d.status::text AS driver_status, d.city_id, dc.status::text AS city_status, dc.billing_mode::text AS billing_mode,
         ds.status::text AS session_status, ds.mode::text AS session_mode, ds.category_id AS session_category,
         COALESCE(dw.balance, 0) AS wallet, COALESCE(dw.is_frozen, false) AS wallet_frozen,
         COALESCE(dpw.balance, 0) AS package_wallet, COALESCE(dpw.is_frozen, false) AS package_frozen,
         EXISTS (SELECT 1 FROM driver_documents dd WHERE dd.driver_id = c.driver_id
                   AND (dd.status = 'rejected' OR (dd.status = 'approved' AND dd.verified_valid_until < CURRENT_DATE)
                        OR (dd.status = 'pending' AND dd.doc_type::text IN ('profile_photo','driving_license_front','driving_license_back','aadhaar_front','aadhaar_back')))) AS identity_doc_issue,
         EXISTS (SELECT 1 FROM driver_vehicle_documents dvd JOIN driver_vehicles dv ON dv.id = dvd.vehicle_id
                  WHERE dv.driver_id = c.driver_id AND dv.is_primary = true
                    AND (dvd.status = 'rejected' OR (dvd.status = 'approved' AND dvd.verified_valid_until < CURRENT_DATE)
                         OR (dvd.status = 'pending' AND dvd.doc_type::text IN ('vehicle_rc_front','vehicle_rc_back','insurance','permit')))) AS vehicle_doc_issue
    FROM cand c
    JOIN drivers d ON d.id = c.driver_id
    LEFT JOIN cities dc ON dc.id = d.city_id
    LEFT JOIN driver_sessions ds ON ds.id = c.session_id
    LEFT JOIN driver_wallets dw ON dw.driver_id = c.driver_id
    LEFT JOIN driver_package_wallets dpw ON dpw.driver_id = c.driver_id
)
SELECT f.driver_id,
       round(f.straight_km::numeric, 1) AS straight_km,
       CASE
         WHEN f.driver_status <> 'active'                         THEN 'driver is ' || f.driver_status
         WHEN f.city_status IS DISTINCT FROM 'active'             THEN 'no active operating city'
         WHEN f.session_status IS DISTINCT FROM 'online'          THEN 'session is ' || COALESCE(f.session_status, 'missing') || ' (offline or on a trip)'
         WHEN f.session_mode IS DISTINCT FROM 'standard'          THEN 'mode is ' || COALESCE(f.session_mode, 'missing') || ' (return-cab drivers match differently)'
         WHEN f.session_category NOT IN (SELECT id FROM cats)     THEN 'vehicle category not accepted (round 1 = exact category only; fallback categories join in round 2)'
         WHEN f.identity_doc_issue OR f.vehicle_doc_issue         THEN 'document issue (rejected, expired or required document still pending)'
         WHEN f.billing_mode = 'commission' AND (f.wallet < (SELECT v FROM min_balance) OR f.wallet_frozen)
                                                                  THEN 'wallet below the minimum or frozen (commission city)'
         WHEN f.billing_mode = 'package' AND (f.package_wallet <= 0 OR f.package_frozen)
                                                                  THEN 'package wallet empty or frozen (package city)'
         WHEN NOT f.is_available AND f.snapshot_updated <= now() - interval '60 seconds'
                                                                  THEN 'marked unavailable more than 60 s ago'
         WHEN f.straight_km > 10                                  THEN 'beyond the 10 km base radius (round 2 adds 1 km, round 3 adds 2 km)'
         ELSE 'matched'
       END AS reason,
       f.session_category AS driver_category, f.is_available,
       round(extract(epoch FROM (now() - f.position_recorded)))::int AS position_age_s,
       round(f.wallet::numeric, 0) AS wallet,
       (SELECT string_agg(a.status::text || ' r' || a.broadcast_round, ', ' ORDER BY a.offered_at)
          FROM ride_assignments a WHERE a.ride_id = :ride_id AND a.driver_id = f.driver_id) AS offer_history_for_this_ride
  FROM facts f
 ORDER BY f.straight_km, f.driver_id
 LIMIT 100;

ROLLBACK;
