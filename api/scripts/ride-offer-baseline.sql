-- Phase 0 baseline for the closed-app ride request work (docs/superpowers/plans/2026-11-05-driver-app-closed-ride-alert-overlay.md).
-- READ ONLY: SELECT statements only. Window: last N days (psql -v days=14, default 14).
--
-- Reading the outcomes (the first version of this script got this wrong):
--   accepted / declined   the driver answered.
--   expired               the window lapsed; the server stamps responded_at, so it is NOT "unanswered" by that column.
--   cancelled, responded_at NULL
--                         the offer was closed before this driver answered, usually because another driver accepted first.
--                         Most are lost races; the ones that stayed open a full window are the likely missed requests.
--   offered               still open or never closed.
--
-- All sections here read existing tables. The split by app state (backgrounded at offer time, live-socket ack, push sent) is NOT in
-- the database: the API logs it as structured lines (event = ride_offer, ride_offer_acked, ride_offer_pushed); see the end of this file.
--
-- Run: psql "$DATABASE_URL" -v days=14 -f api/scripts/ride-offer-baseline.sql   (prod only through the approved read-only tunnel)

\set ON_ERROR_STOP on
\if :{?days}
\else
  \set days 14
\endif

\echo '== 1. Every offer by outcome and whether the driver ever responded'
SELECT status::text AS status, (responded_at IS NOT NULL) AS responded, count(*) AS offers,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
  FROM ride_assignments
 WHERE offered_at > now() - (:'days' || ' days')::interval
 GROUP BY 1, 2 ORDER BY 3 DESC;

\echo '== 2. Offers closed with no response, by how long they stayed open (seconds)'
SELECT CASE WHEN extract(epoch FROM coalesce(cancelled_at, expires_at) - offered_at) < 5  THEN 'a. under 5 s (lost the race)'
            WHEN extract(epoch FROM coalesce(cancelled_at, expires_at) - offered_at) < 15 THEN 'b. 5 to 15 s'
            ELSE 'c. 15 s or more (likely not seen or ignored)' END AS open_for,
       count(*) AS offers
  FROM ride_assignments
 WHERE offered_at > now() - (:'days' || ' days')::interval
   AND responded_at IS NULL AND status = 'cancelled'
 GROUP BY 1 ORDER BY 1;

\echo '== 3. Likely-missed rate by hour of day, IST (no response and open 15 s or more, or expired)'
SELECT extract(hour FROM offered_at AT TIME ZONE 'Asia/Kolkata')::int AS hour_ist,
       count(*) AS offers,
       count(*) FILTER (WHERE status = 'expired'
                          OR (status = 'cancelled' AND responded_at IS NULL
                              AND extract(epoch FROM coalesce(cancelled_at, expires_at) - offered_at) >= 15)) AS likely_missed,
       round(100.0 * count(*) FILTER (WHERE status = 'expired'
                          OR (status = 'cancelled' AND responded_at IS NULL
                              AND extract(epoch FROM coalesce(cancelled_at, expires_at) - offered_at) >= 15)) / count(*), 1) AS likely_missed_pct
  FROM ride_assignments
 WHERE offered_at > now() - (:'days' || ' days')::interval
 GROUP BY 1 ORDER BY 1;

\echo '== 4. Seconds from offer to the driver answer (accepted or declined)'
SELECT status::text AS outcome, count(*) AS n,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM responded_at - offered_at))::numeric, 1) AS p50_s,
       round(percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM responded_at - offered_at))::numeric, 1) AS p90_s,
       round(avg(extract(epoch FROM expires_at - offered_at))::numeric, 1) AS avg_window_s
  FROM ride_assignments
 WHERE offered_at > now() - (:'days' || ' days')::interval
   AND status IN ('accepted', 'declined') AND responded_at IS NOT NULL
 GROUP BY 1;

\echo '== 5. Android share of driver devices, and rides by final status'
SELECT 'device:' || platform AS what, count(DISTINCT owner_id) AS n
  FROM device_tokens
 WHERE owner_type = 'driver' AND last_seen_at > now() - (:'days' || ' days')::interval
 GROUP BY 1
UNION ALL
SELECT 'ride:' || status::text, count(*)
  FROM rides
 WHERE created_at > now() - (:'days' || ' days')::interval
 GROUP BY 1
 ORDER BY 1;

-- 6. App state split (from the API logs, not this database). Log fields on every line: event, rideId, driverId.
--    ride_offer        backgrounded (bool), windowSeconds, round   -> what the server believed about the app at offer time
--    ride_offer_acked                                              -> the live app confirmed receipt over the socket
--    ride_offer_pushed loudDevices, legacyDevices                  -> a push was sent
--    Per (rideId, driverId): backgrounded + acked or not + pushed or not. Join that to this table's outcome (status, responded_at,
--    cancelled_at) on ride_id = rideId and driver_id = driverId. Example Loki query for the offers made in a window:
--      {service="ocar", container="ocar_api"} | json | event=~"ride_offer|ride_offer_acked|ride_offer_pushed"
--    These lines are level info and not "request completed", so the Alloy sampling and 404 filters do not touch them; the S3 archive
--    keeps every API line (190 days).
--    In Athena (app_logs table), filter the same `event` values and group by rideId + driverId.
--    Reading it: acked = the app was open and saw it; pushed but not acked = only the notification could have reached the driver.
