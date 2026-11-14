-- Shadow ETA report (docs/superpowers/plans/2026-11-10-google-maps-cost.md, phase B). READ-ONLY: SELECT statements only.
-- Compares three ETA estimates against the real arrival time, at about 10, 5 and 2 minutes before it:
--   ours_blend  the ETA the proposed design would show (remaining route distance at a speed blended with the driver's observed progress)
--   ours_base   the same remaining distance at the speed Google's route implied ("snap and trim", no observed speed)
--   google      the ETA Google gave the rider's app at that moment (what riders see today)
-- Truth per leg: to_pickup = accepted_at -> driver_arrived_at, to_destination = started_at -> completed_at.
-- Left out: round trips, rides with stops (the wait at a stop is not travel time), legs that never ended, and test accounts
-- (phone numbers starting +9199 or 99999, as in the dispatch monitor). Samples taken while the driver was more than 100 m off the stored
-- route are left out of the ours_* rows and counted in the last statement.
-- Statements are separated by a line with only a semicolon so a test can run them one by one.

-- 1. Error by estimate, leg and distance-to-arrival bucket. Errors are in minutes: positive = ETA too long, negative = too short.
WITH legs AS (
  SELECT r.id AS ride_id, s.leg,
         CASE s.leg WHEN 'to_pickup' THEN r.accepted_at ELSE r.started_at END AS leg_start,
         CASE s.leg WHEN 'to_pickup' THEN r.driver_arrived_at ELSE r.completed_at END AS leg_end
    FROM (SELECT DISTINCT ride_id, leg FROM ride_eta_shadow) s
    JOIN rides r ON r.id = s.ride_id
   WHERE r.ride_type::text <> 'round_trip'
     AND NOT EXISTS (SELECT 1 FROM ride_stops st WHERE st.ride_id = r.id)
     AND r.user_id NOT IN (SELECT id FROM users WHERE phone LIKE '+9199%' OR phone LIKE '99999%')
), samples AS (
  SELECT e.ride_id, e.leg, e.kind, e.eta_sec, e.eta_base_sec, e.off_route_m,
         EXTRACT(EPOCH FROM (l.leg_end - e.at)) AS true_remaining_sec
    FROM ride_eta_shadow e
    JOIN legs l ON l.ride_id = e.ride_id AND l.leg = e.leg
   WHERE l.leg_start IS NOT NULL AND l.leg_end IS NOT NULL AND e.at >= l.leg_start AND e.at < l.leg_end
     AND COALESCE(e.remaining_m, 1000) >= 100  -- a vehicle at the destination waiting for the passenger or the end PIN is not travelling
), estimates AS (
  SELECT ride_id, leg, 'ours_blend' AS estimate, eta_sec AS est_sec, true_remaining_sec FROM samples WHERE kind = 'ours' AND COALESCE(off_route_m, 0) <= 100
  UNION ALL
  SELECT ride_id, leg, 'ours_base', eta_base_sec, true_remaining_sec FROM samples WHERE kind = 'ours' AND eta_base_sec IS NOT NULL AND COALESCE(off_route_m, 0) <= 100
  UNION ALL
  SELECT ride_id, leg, 'google', eta_sec, true_remaining_sec FROM samples WHERE kind = 'google'
), bucketed AS (
  SELECT *, CASE WHEN true_remaining_sec BETWEEN 480 AND 720 THEN '10 min'
                 WHEN true_remaining_sec BETWEEN 240 AND 360 THEN '5 min'
                 WHEN true_remaining_sec BETWEEN 60 AND 180 THEN '2 min' END AS bucket
    FROM estimates
)
SELECT leg, bucket, estimate,
       count(*) AS samples,
       count(DISTINCT ride_id) AS rides,
       round((avg(abs(est_sec - true_remaining_sec)) / 60)::numeric, 2) AS mean_abs_error_min,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(est_sec - true_remaining_sec)) / 60)::numeric, 2) AS median_abs_error_min,
       round((percentile_cont(0.9) WITHIN GROUP (ORDER BY abs(est_sec - true_remaining_sec)) / 60)::numeric, 2) AS p90_abs_error_min,
       round((avg(est_sec - true_remaining_sec) / 60)::numeric, 2) AS bias_min
  FROM bucketed
 WHERE bucket IS NOT NULL
 GROUP BY leg, bucket, estimate
 ORDER BY leg, CASE bucket WHEN '10 min' THEN 1 WHEN '5 min' THEN 2 ELSE 3 END, estimate
;

-- 2. How much evidence there is: legs with samples, by leg and estimate kind (the adoption rule wants about 150 intercity to_destination legs).
SELECT e.leg, e.kind, count(DISTINCT e.ride_id) AS rides, count(*) AS samples,
       min(e.at) AS first_sample, max(e.at) AS last_sample
  FROM ride_eta_shadow e
  JOIN rides r ON r.id = e.ride_id
 WHERE r.ride_type::text <> 'round_trip'
   AND NOT EXISTS (SELECT 1 FROM ride_stops st WHERE st.ride_id = r.id)
   AND r.user_id NOT IN (SELECT id FROM users WHERE phone LIKE '+9199%' OR phone LIKE '99999%')
 GROUP BY e.leg, e.kind
 ORDER BY e.leg, e.kind
;

-- 3. Samples taken off the stored route (more than 100 m away): how often the stored line stopped fitting.
SELECT leg, count(*) FILTER (WHERE kind = 'ours') AS ours_samples,
       count(*) FILTER (WHERE kind = 'ours' AND off_route_m > 100) AS off_route_samples,
       round(100.0 * count(*) FILTER (WHERE kind = 'ours' AND off_route_m > 100) / NULLIF(count(*) FILTER (WHERE kind = 'ours'), 0), 1) AS off_route_pct
  FROM ride_eta_shadow
 GROUP BY leg
 ORDER BY leg
;
