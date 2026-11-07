-- Phase 0 baseline for the closed-app ride request work (docs/superpowers/plans/2026-11-05-driver-app-closed-ride-alert-overlay.md).
-- READ ONLY: SELECT statements only. Counts only offers where the driver had to answer (accepted, declined, expired); "cancelled" means
-- another driver accepted first, so it says nothing about this driver. Window: last 14 days (change :days below).
--
-- What this CAN answer today: how often offers expire unanswered ("missed"), by hour, by driver, and how long answers take.
-- What it CANNOT answer: app state (open, background, closed) and phone brand, because ride_assignments does not record them.
-- Those need the small instrumentation listed in the plan (phase 0); this file is the part that needs no code change.
--
-- Run: psql "$DATABASE_URL" -v days=14 -f api/scripts/ride-offer-baseline.sql   (against prod only through the approved read-only tunnel)

\set ON_ERROR_STOP on
\if :{?days}
\else
  \set days 14
\endif

\echo '== 1. Outcome of every offer that needed an answer'
SELECT status::text AS outcome,
       count(*) AS offers,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
  FROM ride_assignments
 WHERE offered_at > now() - (:'days' || ' days')::interval
   AND status IN ('accepted', 'declined', 'expired')
 GROUP BY 1 ORDER BY 2 DESC;

\echo '== 2. Missed (expired) rate by hour of day, IST'
SELECT extract(hour FROM offered_at AT TIME ZONE 'Asia/Kolkata')::int AS hour_ist,
       count(*) FILTER (WHERE status IN ('accepted', 'declined', 'expired')) AS answerable,
       count(*) FILTER (WHERE status = 'expired') AS missed,
       round(100.0 * count(*) FILTER (WHERE status = 'expired')
             / NULLIF(count(*) FILTER (WHERE status IN ('accepted', 'declined', 'expired')), 0), 1) AS missed_pct
  FROM ride_assignments
 WHERE offered_at > now() - (:'days' || ' days')::interval
 GROUP BY 1 ORDER BY 1;

\echo '== 3. Drivers with the highest missed rate (at least 10 answerable offers)'
SELECT driver_id,
       count(*) FILTER (WHERE status IN ('accepted', 'declined', 'expired')) AS answerable,
       count(*) FILTER (WHERE status = 'expired') AS missed,
       round(100.0 * count(*) FILTER (WHERE status = 'expired')
             / NULLIF(count(*) FILTER (WHERE status IN ('accepted', 'declined', 'expired')), 0), 1) AS missed_pct
  FROM ride_assignments
 WHERE offered_at > now() - (:'days' || ' days')::interval
 GROUP BY 1
HAVING count(*) FILTER (WHERE status IN ('accepted', 'declined', 'expired')) >= 10
 ORDER BY missed_pct DESC, answerable DESC
 LIMIT 20;

\echo '== 4. Seconds from offer to the driver answer (accepted or declined)'
SELECT status::text AS outcome,
       count(*) AS n,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM responded_at - offered_at))::numeric, 1) AS p50_s,
       round(percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM responded_at - offered_at))::numeric, 1) AS p90_s,
       round(avg(extract(epoch FROM expires_at - offered_at))::numeric, 1) AS avg_window_s
  FROM ride_assignments
 WHERE offered_at > now() - (:'days' || ' days')::interval
   AND status IN ('accepted', 'declined')
   AND responded_at IS NOT NULL
 GROUP BY 1;

\echo '== 5. Android share of driver devices (the plan is Android only)'
SELECT platform, count(DISTINCT owner_id) AS drivers
  FROM device_tokens
 WHERE owner_type = 'driver'
   AND last_seen_at > now() - (:'days' || ' days')::interval
 GROUP BY 1 ORDER BY 2 DESC;
