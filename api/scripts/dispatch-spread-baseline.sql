-- Baseline for the dispatch-spread plan (docs/superpowers/plans/2026-11-08-dispatch-spread-to-more-drivers.md), Gate 0.
-- READ ONLY: SELECT statements only; the transaction is set READ ONLY before the first query on a real table. Window: last N days (psql -v days=14, default 14).
--
-- Run: psql "$DATABASE_URL" -v days=14 -f api/scripts/dispatch-spread-baseline.sql   (prod only with the owner's approval, through the read-only tunnel)
--
-- The synthetic load-test data seeded into live prod on 2026-10-16/27 is excluded by IDENTIFYING COLUMNS, not by date:
-- drivers with phone '+918888%' and riders with phone '+9199%' (and '99999%'). Real rides share that database.
--
-- Known limits (read these before trusting a number):
--   * ride_assignments has ONE row per (ride, driver): a later round overwrites broadcast_round, expires_at and status but keeps the
--     FIRST offered_at. So an answer time (responded_at - offered_at) is only clean for rows still on round 1.
--   * A re-offer is detected by a proxy: the row's offered_at is within 10 s of the ride's first offer yet its round is above 1
--     (first offered in round 1, offered again later). A driver first offered in a later round has a later offered_at and is not counted.
--   * Acknowledgements are not stored (log lines only, event = ride_offer_acked); "eligible drivers in range at the time" is not
--     stored either. Those two need the #300 delivery logs and a position-history source.

\set ON_ERROR_STOP on
\if :{?days}
\else
  \set days 14
\endif

BEGIN;

-- Two temporary views (they live only in this session's temp schema and read nothing yet), then the transaction is switched to READ ONLY
-- before any statement touches a real table.
CREATE TEMP VIEW real_assignments AS
  SELECT a.*
    FROM ride_assignments a
    JOIN rides r   ON r.id = a.ride_id
    JOIN drivers d ON d.id = a.driver_id
    JOIN users u   ON u.id = r.user_id
   WHERE a.offered_at > now() - (:'days' || ' days')::interval
     AND d.phone NOT LIKE '+918888%'
     AND u.phone NOT LIKE '+9199%' AND u.phone NOT LIKE '99999%';

CREATE TEMP VIEW real_rides AS
  SELECT r.*
    FROM rides r JOIN users u ON u.id = r.user_id
   WHERE r.requested_at > now() - (:'days' || ' days')::interval
     AND u.phone NOT LIKE '+9199%' AND u.phone NOT LIKE '99999%';

SET TRANSACTION READ ONLY;

\echo '== 0. Sample size (decide whether the window is large enough before reading anything below)'
SELECT (SELECT count(*) FROM real_rides) AS rides,
       (SELECT count(*) FROM real_assignments) AS offers,
       (SELECT count(DISTINCT driver_id) FROM real_assignments) AS drivers_offered;

\echo
\echo '== 1. How long drivers really take to answer (round-1 rows only; seconds)'
SELECT status::text, count(*) AS answers,
       round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY extract(epoch FROM (responded_at - offered_at))))::numeric, 1) AS p50_s,
       round((percentile_cont(0.9)  WITHIN GROUP (ORDER BY extract(epoch FROM (responded_at - offered_at))))::numeric, 1) AS p90_s,
       round((percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (responded_at - offered_at))))::numeric, 1) AS p95_s
  FROM real_assignments
 WHERE broadcast_round = 1 AND status IN ('accepted', 'declined') AND responded_at IS NOT NULL
 GROUP BY 1 ORDER BY 1;

\echo
\echo '== 2. Offers by outcome (all rounds). expired = the window lapsed with no answer; cancelled = closed because another driver accepted first (or the ride ended)'
SELECT status::text, count(*) AS offers, round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
  FROM real_assignments GROUP BY 1 ORDER BY 2 DESC;

\echo
\echo '== 3. How many different drivers each ride was offered to'
SELECT drivers_offered, count(*) AS rides, round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
  FROM (SELECT ride_id, count(DISTINCT driver_id) AS drivers_offered FROM real_assignments GROUP BY ride_id) x
 GROUP BY 1 ORDER BY 1;

\echo
\echo '== 4. Re-offers (proxy): first offered in round 1, offered again in a later round'
WITH first_offer AS (SELECT ride_id, min(offered_at) AS t0 FROM real_assignments GROUP BY ride_id)
SELECT a.status::text AS status_now, count(*) AS reoffered_rows,
       round(100.0 * count(*) / NULLIF((SELECT count(*) FROM real_assignments), 0), 1) AS pct_of_all_offers
  FROM real_assignments a JOIN first_offer f USING (ride_id)
 WHERE a.broadcast_round > 1 AND a.offered_at < f.t0 + interval '10 seconds'
 GROUP BY 1 ORDER BY 2 DESC;

\echo
\echo '== 5. Rides that ended with no driver, and time to first accept (seconds)'
SELECT count(*) FILTER (WHERE status = 'no_drivers') AS no_drivers_rides,
       round(100.0 * count(*) FILTER (WHERE status = 'no_drivers') / NULLIF(count(*), 0), 1) AS no_drivers_pct,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (accepted_at - requested_at))) FILTER (WHERE accepted_at IS NOT NULL))::numeric, 1) AS accept_p50_s,
       round((percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (accepted_at - requested_at))) FILTER (WHERE accepted_at IS NOT NULL))::numeric, 1) AS accept_p90_s
  FROM real_rides WHERE status NOT IN ('scheduled');

\echo
\echo '== 6. How evenly offers are spread over drivers (higher top-10% share = more concentrated)'
WITH per_driver AS (SELECT driver_id, count(*) AS offers FROM real_assignments GROUP BY driver_id),
     ranked AS (SELECT offers, ntile(10) OVER (ORDER BY offers DESC) AS decile FROM per_driver)
SELECT (SELECT count(*) FROM per_driver) AS drivers_with_offers,
       (SELECT count(DISTINCT s.driver_id) FROM driver_sessions s JOIN drivers d ON d.id = s.driver_id
         WHERE s.went_online_at > now() - (:'days' || ' days')::interval AND d.phone NOT LIKE '+918888%') AS drivers_who_went_online,
       round(100.0 * sum(offers) FILTER (WHERE decile = 1) / NULLIF(sum(offers), 0), 1) AS top10pct_drivers_share_of_offers
  FROM ranked;

ROLLBACK;
