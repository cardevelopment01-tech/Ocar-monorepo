-- Load-test seed data — 1M historical rides + synthetic riders.
--
-- Implements docs/superpowers/specs/2026-08-31-load-test-seed-data-spec.md.
-- Cross-reference: docs/LOAD_TEST_PLAN.md §3 (what gets seeded, safety rules).
--
-- SCOPE (per the spec's §1 finding): rides, ride_status_history,
-- fare_snapshots, payments, ride_cancellations, ratings, and synthetic
-- `users` rows only. Reuses real active drivers/vehicles and the reference
-- data already in 016_seed.sql (cities, vehicle_categories, rate_cards,
-- rental_packages). Deliberately does NOT touch gps_tracks,
-- driver_sessions, driver_location_snapshots, ride_assignments,
-- ride_messages, or any wallet/notification tables — none of those are
-- read by the four critical queries this data exists to test, and they're
-- either live-fleet state the traffic ramp produces itself, or genuinely
-- out of scope (see spec §1).
--
-- SAFETY: every synthetic rider is created with phone LIKE '+919999%' (spec
-- §5) so it can be found and deleted unambiguously later. Real drivers are
-- only ever read, never inserted/updated. Nothing here touches production —
-- point DATABASE_URL at local dev or staging only.
--
-- REQUIRED BEFORE RUNNING ON STAGING (not required for a local dev run):
-- run `SELECT count(*) FROM users WHERE phone LIKE '+919999%'` first and
-- confirm it's 0 (spec §7, open question 1) — the 9999 mobile series is a
-- real allocated Indian range, this only guarantees no collision in this DB.
--
-- Usage:
--   psql "$DATABASE_URL" -f api/scripts/seed-load-test-data.sql
--   psql "$DATABASE_URL" -v riders_count=5000 -v rides_count=50000 \
--        -f api/scripts/seed-load-test-data.sql   -- smaller smoke-test run
--
-- Prerequisite: at least one row in `drivers` with status='active' that has
-- a driver_vehicles row with status='active' AND is_primary=true. Locally
-- this can be as few as 1 (onboard/approve one test driver first) — the
-- "reuse real drivers, never fabricate" rule (LOAD_TEST_PLAN.md §3) is a
-- staging/production safety rule, not something this script enforces a
-- minimum count for.
--
-- Known simplifications (ponytail: deliberate, not oversights):
--   - Dates are uniform-random over the trailing 365 days, no weekday/
--     evening skew — spec §3 confirms the critical queries only care about
--     full-range spread, not intra-day shape.
--   - fare_snapshots numbers are computed independently in SQL (same shape
--     as lib/fare.ts) rather than re-derived bit-for-bit from the TS engine
--     — spec §6 confirms "internally consistent" is sufficient since only
--     the four critical query plans are under test, not receipt accuracy.
--   - No cross-city origin/destination pairs, no ride_stops, no rating_tags,
--     no SOS/review-flag edge rows, no cash_collected_amount/cash_discrepancy
--     — all explicitly out-of-scope or optional per the spec; add later if a
--     specific admin filter needs to be exercised under load and isn't yet.
--   - Origin/destination points are independent random draws inside the
--     city bbox, not a real road-network route.

-- \set unconditionally overwrites, so a bare `\set riders_count 50000` here
-- would silently clobber `-v riders_count=...` passed on the command line
-- (found the hard way: a "smoke test" run with -v rides_count=5000 actually
-- ran the full 1,000,000 because of this). Only default when unset.
\if :{?riders_count}
\else
  \set riders_count 50000
\endif
\if :{?rides_count}
\else
  \set rides_count 1000000
\endif

\echo 'Seeding load-test data...'

-- ── 0. Preflight ──────────────────────────────────────────────────────
DO $$
DECLARE
  driver_pool_size INT;
  city_count       INT;
BEGIN
  SELECT count(*) INTO driver_pool_size
  FROM drivers d
  JOIN driver_vehicles dv ON dv.driver_id = d.id
  WHERE d.status = 'active' AND dv.status = 'active' AND dv.is_primary = true;

  IF driver_pool_size = 0 THEN
    RAISE EXCEPTION 'No active driver with an active primary vehicle found. Onboard and approve at least one test driver + vehicle before running this seed.';
  END IF;

  -- Puri is excluded from geo distribution below: its 016_seed.sql row is
  -- status='draft' (not live yet) — seeding rides "in" a non-live city
  -- would be inaccurate test data, not a shortcut.
  SELECT count(*) INTO city_count FROM cities WHERE slug IN ('bhubaneswar', 'cuttack');
  IF city_count < 2 THEN
    RAISE EXCEPTION 'Expected cities "bhubaneswar" and "cuttack" (016_seed.sql) to exist — run migrations first.';
  END IF;

  RAISE NOTICE 'Preflight OK: % active driver+vehicle pairs available.', driver_pool_size;
END $$;

-- ── 1. Real driver/vehicle pool (reused, never fabricated) ───────────
CREATE TEMP TABLE t_drivers AS
SELECT
  d.id AS driver_id,
  dv.id AS vehicle_id,
  dv.category_id,
  row_number() OVER (ORDER BY random()) AS rn
FROM drivers d
JOIN driver_vehicles dv ON dv.driver_id = d.id
WHERE d.status = 'active' AND dv.status = 'active' AND dv.is_primary = true;

-- ── 2. Synthetic riders ────────────────────────────────────────────────
-- phone: reserved block +919999000000-+919999999999 (spec §5). name/email
-- are secondary tags so cleanup never depends on a single column.
CREATE TEMP TABLE t_users AS
WITH ins AS (
  INSERT INTO users (phone, name, email, status)
  SELECT
    '+919999' || lpad(i::text, 6, '0'),
    'LT Rider ' || i,
    'loadtest+usr' || i || '@ocar.invalid',
    'active'
  FROM generate_series(1, :riders_count) AS i
  RETURNING id
)
SELECT id, row_number() OVER () AS rn FROM ins;

\echo 'Synthetic riders inserted.'

-- ── 3. Rides ────────────────────────────────────────────────────────────
-- Status mix: 72% completed / 18% cancelled / 5% no_drivers / 1% each of
-- accepted,driver_arrived,in_progress,scheduled / <1% returning.
-- Ride type: 70% one_way / 20% round_trip / 10% rental.
-- Geo: 70% Bhubaneswar / 30% Cuttack, real bounding boxes (017_city_boundaries.sql).
CREATE TEMP TABLE t_rides AS
WITH ref_ids AS (
  SELECT
    (SELECT id FROM cities WHERE slug = 'bhubaneswar')          AS bbsr_id,
    (SELECT id FROM cities WHERE slug = 'cuttack')              AS ctc_id,
    (SELECT id FROM vehicle_categories WHERE slug = 'sedan')     AS sedan_id,
    (SELECT id FROM vehicle_categories WHERE slug = 'hatchback') AS hatchback_id,
    (SELECT id FROM vehicle_categories WHERE slug = 'suv')       AS suv_id,
    (SELECT id FROM vehicle_categories WHERE slug = 'van')       AS van_id,
    (SELECT id FROM vehicle_categories WHERE slug = 'luxury')    AS luxury_id
),
pool_sizes AS (
  SELECT
    (SELECT count(*) FROM t_users)   AS user_n,
    (SELECT count(*) FROM t_drivers) AS driver_n
),
draws AS (
  SELECT
    i,
    -- FK picks, skewed toward low rn via power(random(),3) so a minority of
    -- riders/drivers accumulate a disproportionate share of history
    -- (realistic power-law depth for the driver/rider-history queries).
    (ceil(power(random(), 3) * ps.user_n))::bigint   AS user_rn,
    (ceil(power(random(), 3) * ps.driver_n))::bigint AS driver_rn,
    random() AS r_status,
    random() AS r_type,
    random() AS r_city,
    random() AS r_cat,
    random() AS r_return,        -- is_return_cab (one_way only)
    random() AS r_cancel_driver, -- did a driver get assigned before this cancel?
    random() AS r_cancel_reason,
    random() AS r_date,
    random() AS r_olng, random() AS r_olat,
    random() AS r_dlng, random() AS r_dlat,
    random() AS r_th_rt,         -- round_trip trip_hours bucket
    random() AS r_th_rental,     -- rental trip_hours bucket
    random() AS r_km,            -- distance noise
    random() AS r_dur,           -- duration noise
    random() AS r_accept_gap,
    random() AS r_arrive_gap,
    random() AS r_start_gap,
    random() AS r_cancel_gap,
    random() AS r_sched,
    random() AS r_return_frac
  FROM generate_series(1, :rides_count) AS i, pool_sizes ps
),
picks AS (
  SELECT
    d.*,
    u.id AS user_id,
    drv.driver_id   AS pool_driver_id,
    drv.vehicle_id  AS pool_vehicle_id,
    drv.category_id AS pool_category_id,
    CASE WHEN d.r_city < 0.70 THEN r.bbsr_id ELSE r.ctc_id END AS city_id,
    CASE WHEN d.r_city < 0.70 THEN 85.75 + d.r_olng * (85.92 - 85.75)
                               ELSE 85.82 + d.r_olng * (85.93 - 85.82) END AS origin_lng,
    CASE WHEN d.r_city < 0.70 THEN 20.20 + d.r_olat * (20.36 - 20.20)
                               ELSE 20.42 + d.r_olat * (20.52 - 20.42) END AS origin_lat,
    CASE WHEN d.r_city < 0.70 THEN 85.75 + d.r_dlng * (85.92 - 85.75)
                               ELSE 85.82 + d.r_dlng * (85.93 - 85.82) END AS dest_lng,
    CASE WHEN d.r_city < 0.70 THEN 20.20 + d.r_dlat * (20.36 - 20.20)
                               ELSE 20.42 + d.r_dlat * (20.52 - 20.42) END AS dest_lat,
    CASE WHEN d.r_cat < 0.40 THEN r.sedan_id
         WHEN d.r_cat < 0.70 THEN r.hatchback_id
         WHEN d.r_cat < 0.90 THEN r.suv_id
         WHEN d.r_cat < 0.97 THEN r.van_id
         ELSE r.luxury_id END AS indep_category_id
  FROM draws d
  CROSS JOIN ref_ids r
  JOIN t_users u ON u.rn = d.user_rn
  LEFT JOIN t_drivers drv ON drv.rn = d.driver_rn
),
final AS (
  SELECT
    p.*,
    (CASE WHEN p.r_status < 0.72 THEN 'completed'
          WHEN p.r_status < 0.90 THEN 'cancelled'
          WHEN p.r_status < 0.95 THEN 'no_drivers'
          WHEN p.r_status < 0.96 THEN 'accepted'
          WHEN p.r_status < 0.97 THEN 'driver_arrived'
          WHEN p.r_status < 0.98 THEN 'in_progress'
          WHEN p.r_status < 0.99 THEN 'scheduled'
          ELSE 'returning' END)::ride_status AS status,
    (CASE WHEN p.r_type < 0.70 THEN 'one_way'
          WHEN p.r_type < 0.90 THEN 'round_trip'
          ELSE 'rental' END)::ride_type AS ride_type,
    (now() - (p.r_date * interval '365 days')) AS requested_at
  FROM picks p
),
resolved AS (
  SELECT
    f.i, f.user_id, f.status, f.ride_type, f.requested_at, f.city_id,
    f.origin_lng, f.origin_lat, f.dest_lng, f.dest_lat,
    (f.ride_type = 'one_way' AND f.r_return < 0.10) AS is_return_cab,
    CASE WHEN f.pool_driver_id IS NOT NULL AND (
           f.status IN ('completed', 'accepted', 'driver_arrived', 'in_progress', 'returning')
           OR (f.status = 'cancelled' AND f.r_cancel_driver >= 0.70)
         ) THEN f.pool_driver_id END AS driver_id,
    CASE WHEN f.pool_driver_id IS NOT NULL AND (
           f.status IN ('completed', 'accepted', 'driver_arrived', 'in_progress', 'returning')
           OR (f.status = 'cancelled' AND f.r_cancel_driver >= 0.70)
         ) THEN f.pool_vehicle_id END AS vehicle_id,
    CASE WHEN f.status IN ('completed', 'accepted', 'driver_arrived', 'in_progress', 'returning')
              OR (f.status = 'cancelled' AND f.r_cancel_driver >= 0.70)
         THEN f.pool_category_id ELSE f.indep_category_id END AS category_id,
    -- round_trip: weighted toward shorter same-day durations
    (CASE WHEN f.r_th_rt < 0.15 THEN 4 WHEN f.r_th_rt < 0.35 THEN 6
          WHEN f.r_th_rt < 0.55 THEN 8 WHEN f.r_th_rt < 0.70 THEN 10
          WHEN f.r_th_rt < 0.90 THEN 24 ELSE 48 END)::smallint AS rt_trip_hours,
    -- rental: uniform over the 6 seeded package durations (1,2,4,6,8,10h)
    (CASE WHEN f.r_th_rental < 0.167 THEN 1 WHEN f.r_th_rental < 0.333 THEN 2
          WHEN f.r_th_rental < 0.50  THEN 4 WHEN f.r_th_rental < 0.667 THEN 6
          WHEN f.r_th_rental < 0.833 THEN 8 ELSE 10 END)::smallint AS rental_trip_hours,
    f.r_km, f.r_dur, f.r_accept_gap, f.r_arrive_gap, f.r_start_gap, f.r_cancel_gap,
    f.r_sched, f.r_return_frac, f.r_cancel_reason
  FROM final f
),
staged AS (
  SELECT
    r.*,
    (CASE WHEN r.ride_type = 'round_trip' THEN r.rt_trip_hours
          WHEN r.ride_type = 'rental' THEN r.rental_trip_hours
          ELSE NULL END) AS trip_hours
  FROM resolved r
),
timed AS (
  SELECT
    s.*,
    (CASE WHEN s.driver_id IS NOT NULL
          THEN s.requested_at + ((30 + s.r_accept_gap * 150) * interval '1 second')
     END) AS accepted_at
  FROM staged s
),
timed2 AS (
  SELECT
    t.*,
    (CASE WHEN t.accepted_at IS NOT NULL AND t.status IN ('completed', 'driver_arrived', 'in_progress', 'returning')
          THEN t.accepted_at + ((120 + t.r_arrive_gap * 480) * interval '1 second')
          WHEN t.accepted_at IS NOT NULL AND t.status = 'cancelled' AND t.r_cancel_reason < 0.35
          THEN t.accepted_at + ((120 + t.r_arrive_gap * 480) * interval '1 second')
     END) AS driver_arrived_at
  FROM timed t
),
timed3 AS (
  SELECT
    t2.*,
    (CASE WHEN t2.driver_arrived_at IS NOT NULL AND t2.status IN ('completed', 'in_progress', 'returning')
          THEN t2.driver_arrived_at + ((60 + t2.r_start_gap * 240) * interval '1 second')
          WHEN t2.driver_arrived_at IS NOT NULL AND t2.status = 'cancelled' AND t2.r_cancel_reason < 0.15
          THEN t2.driver_arrived_at + ((60 + t2.r_start_gap * 240) * interval '1 second')
     END) AS started_at
  FROM timed2 t2
),
final_rows AS (
  SELECT
    t3.*,
    (CASE
       WHEN t3.ride_type = 'one_way' THEN 10 + t3.r_dur * 60
       ELSE t3.trip_hours * 60 * (0.75 + t3.r_dur * 0.35)
     END) AS trip_duration_min,
    (CASE
       WHEN t3.ride_type = 'one_way' THEN 2 + t3.r_km * 18
       WHEN t3.ride_type = 'round_trip' THEN GREATEST(1, CEIL(t3.trip_hours / 24.0)) * (180 + t3.r_km * 140)
       ELSE (t3.trip_hours * 10) * (0.5 + t3.r_km * 0.7)  -- rental: fraction of km_limit (duration_hours*10)
     END) AS trip_distance_km
  FROM timed3 t3
),
ins AS (
  INSERT INTO rides (
    user_id, driver_id, vehicle_id, category_id, ride_type, is_return_cab, status,
    origin, destination, origin_city_id, destination_city_id,
    trip_hours, scheduled_for,
    requested_at, accepted_at, driver_arrived_at, started_at, completed_at, cancelled_at,
    actual_distance_km, actual_duration_min, return_started_at,
    created_at, updated_at
  )
  SELECT
    fr.user_id, fr.driver_id, fr.vehicle_id, fr.category_id, fr.ride_type, fr.is_return_cab, fr.status,
    ST_SetSRID(ST_MakePoint(fr.origin_lng, fr.origin_lat), 4326)::geography,
    CASE WHEN fr.ride_type <> 'rental'
         THEN ST_SetSRID(ST_MakePoint(fr.dest_lng, fr.dest_lat), 4326)::geography END,
    fr.city_id,
    CASE WHEN fr.ride_type <> 'rental' THEN fr.city_id END,
    fr.trip_hours,
    CASE WHEN fr.status = 'scheduled' THEN fr.requested_at + ((1 + fr.r_sched * 13) * interval '1 day') END,
    fr.requested_at, fr.accepted_at, fr.driver_arrived_at, fr.started_at,
    CASE WHEN fr.status = 'completed' THEN fr.started_at + (fr.trip_duration_min * interval '1 minute') END,
    CASE WHEN fr.status = 'cancelled' THEN
      COALESCE(fr.started_at, fr.driver_arrived_at, fr.accepted_at, fr.requested_at)
        + ((30 + fr.r_cancel_gap * 600) * interval '1 second')
    END,
    CASE WHEN fr.status = 'completed' THEN round(fr.trip_distance_km::numeric, 2) END,
    CASE WHEN fr.status = 'completed' THEN round(fr.trip_duration_min::numeric, 2) END,
    CASE WHEN fr.status = 'returning'
         THEN fr.started_at + ((fr.trip_duration_min * (0.4 + fr.r_return_frac * 0.3)) * interval '1 minute') END,
    fr.requested_at, fr.requested_at
  FROM final_rows fr
  RETURNING
    id, user_id, driver_id, category_id, ride_type, is_return_cab, status,
    origin_city_id, trip_hours, requested_at, accepted_at, driver_arrived_at,
    started_at, completed_at, cancelled_at, actual_distance_km, actual_duration_min,
    return_started_at
)
SELECT * FROM ins;

\echo 'Rides inserted.'

-- ── 4. Ride cancellations ────────────────────────────────────────────
-- Stage is derived from how far the ride actually got (which timestamps
-- are set), not a separate random draw — keeps it internally consistent
-- with the rides row it belongs to.
CREATE TEMP TABLE t_cancellations AS
WITH src AS (
  SELECT
    tr.id AS ride_id, tr.driver_id, tr.user_id,
    (CASE
       WHEN tr.started_at IS NOT NULL THEN 'in_progress'
       WHEN tr.driver_arrived_at IS NOT NULL THEN 'after_arrival'
       WHEN tr.accepted_at IS NOT NULL THEN 'after_acceptance'
       WHEN random() < 0.15 THEN 'before_dispatch'
       ELSE 'before_acceptance'
     END)::cancel_stage AS stage,
    random() AS r_actor
  FROM t_rides tr
  WHERE tr.status = 'cancelled'
),
picked AS (
  SELECT
    ride_id, driver_id, user_id, stage,
    (CASE
       WHEN stage IN ('before_dispatch', 'before_acceptance') THEN
         CASE WHEN r_actor < 0.85 THEN 'user' WHEN r_actor < 0.95 THEN 'system' ELSE 'admin' END
       ELSE
         CASE WHEN r_actor < 0.55 THEN 'user' WHEN r_actor < 0.90 THEN 'driver' ELSE 'admin' END
     END)::cancel_actor AS actor
  FROM src
),
ins AS (
  INSERT INTO ride_cancellations (
    ride_id, actor, stage, cancelled_by_user_id, cancelled_by_driver_id,
    reason, reason_code, fee_applicable, fee_amount
  )
  SELECT
    p.ride_id, p.actor, p.stage,
    CASE WHEN p.actor = 'user' THEN p.user_id END,
    CASE WHEN p.actor = 'driver' THEN p.driver_id END,
    CASE p.actor WHEN 'user' THEN 'Rider changed plans'
                 WHEN 'driver' THEN 'Driver unable to continue'
                 WHEN 'system' THEN 'No response before timeout'
                 ELSE 'Cancelled by support' END,
    CASE p.actor WHEN 'user' THEN 'user_cancelled'
                 WHEN 'driver' THEN 'driver_cancelled'
                 WHEN 'system' THEN 'timeout'
                 ELSE 'admin_cancelled' END,
    p.stage IN ('after_acceptance', 'after_arrival', 'in_progress'),
    CASE WHEN p.stage IN ('after_acceptance', 'after_arrival', 'in_progress') THEN 50.00 ELSE 0.00 END
  FROM picked p
  RETURNING ride_id, actor
)
SELECT * FROM ins;

\echo 'Ride cancellations inserted.'

-- ── 5. Fare snapshots (1 per ride, incl. cancelled/no_drivers) ────────
-- rate_cards lookup mirrors CLAUDE.md's documented city-override rule
-- (078_city_wise_rate_cards.sql): city-specific row wins over the global
-- (city_id IS NULL) row for the same (category_id, ride_type) — a plain
-- join here would double-match and violate fare_snapshots' UNIQUE(ride_id).
-- rental_packages has since evolved past what the spec/migration read
-- showed: it's keyed on duration_minutes (not duration_hours) and is now
-- city-scoped the same way rate_cards is (found live via \d rental_packages
-- against the actual dev DB, not from a migration file) — same LATERAL
-- city-priority pattern applied here too.
CREATE TEMP TABLE t_fares AS
WITH src AS (
  SELECT
    tr.id AS ride_id, tr.category_id, tr.ride_type, tr.is_return_cab, tr.status,
    tr.trip_hours, tr.completed_at, tr.actual_distance_km, tr.actual_duration_min,
    rc.id AS rate_card_id, rc.rate_per_km, rc.rate_per_min, rc.min_fare,
    rc.return_rate_per_km, rc.km_per_day, rc.driver_allowance_per_day,
    rp.id AS rental_package_id, rp.package_fare, rp.extra_per_km, rp.extra_per_min, rp.km_limit,
    random() AS r_est_km, random() AS r_est_min, random() AS r_surge
  FROM t_rides tr
  JOIN LATERAL (
    SELECT * FROM rate_cards rc
    WHERE rc.category_id = tr.category_id AND rc.ride_type = tr.ride_type
      AND rc.effective_to IS NULL AND (rc.city_id = tr.origin_city_id OR rc.city_id IS NULL)
    ORDER BY rc.city_id NULLS LAST
    LIMIT 1
  ) rc ON true
  LEFT JOIN LATERAL (
    SELECT * FROM rental_packages rp
    WHERE tr.ride_type = 'rental' AND rp.category_id = tr.category_id
      AND rp.duration_minutes = tr.trip_hours * 60
      AND (rp.city_id = tr.origin_city_id OR rp.city_id IS NULL)
    ORDER BY rp.city_id NULLS LAST
    LIMIT 1
  ) rp ON true
),
calc AS (
  SELECT
    s.*,
    (CASE WHEN s.r_surge < 0.90 THEN 1.00 WHEN s.r_surge < 0.98 THEN 1.25 ELSE 1.50 END) AS surge_multiplier,
    (CASE WHEN s.is_return_cab AND s.return_rate_per_km IS NOT NULL
          THEN s.return_rate_per_km ELSE s.rate_per_km END) AS per_km,
    GREATEST(1, CEIL(COALESCE(s.trip_hours, 0) / 24.0)) AS days,
    (CASE WHEN s.ride_type = 'one_way' THEN 2 + s.r_est_km * 18
          WHEN s.ride_type = 'round_trip' THEN GREATEST(1, CEIL(s.trip_hours / 24.0)) * (180 + s.r_est_km * 140)
          ELSE COALESCE(s.km_limit, 10) * (0.5 + s.r_est_km * 0.7)
     END) AS estimated_km,
    (CASE WHEN s.ride_type = 'one_way' THEN 10 + s.r_est_min * 60
          ELSE s.trip_hours * 60 * (0.75 + s.r_est_min * 0.35)
     END) AS estimated_min
  FROM src s
),
components AS (
  SELECT
    c.*,
    (CASE WHEN c.ride_type = 'one_way' THEN round((c.estimated_km * c.per_km)::numeric, 2)
          WHEN c.ride_type = 'round_trip' THEN round((c.days * COALESCE(c.km_per_day, 0) * c.per_km)::numeric, 2)
          ELSE 0 END) AS distance_fare,
    (CASE WHEN c.ride_type = 'one_way' THEN round((c.estimated_min * c.rate_per_min)::numeric, 2)
          ELSE 0 END) AS time_fare,
    (CASE WHEN c.ride_type = 'round_trip' THEN round((c.days * COALESCE(c.driver_allowance_per_day, 0))::numeric, 2)
          ELSE 0 END) AS hour_surcharge,
    (CASE WHEN c.ride_type = 'round_trip'
            THEN round((GREATEST(c.estimated_km - c.days * COALESCE(c.km_per_day, 0), 0) * c.per_km)::numeric, 2)
          WHEN c.ride_type = 'rental'
            THEN round((GREATEST(c.estimated_km - COALESCE(c.km_limit, 0), 0) * COALESCE(c.extra_per_km, 0))::numeric, 2)
          ELSE 0 END) AS overage_fare,
    (CASE WHEN c.ride_type = 'rental' THEN COALESCE(c.package_fare, c.min_fare) ELSE 0 END) AS rental_base
  FROM calc c
),
totals AS (
  SELECT
    cm.*,
    (CASE WHEN cm.ride_type = 'one_way' THEN GREATEST(cm.min_fare - (cm.distance_fare + cm.time_fare), 0)
          ELSE 0 END) AS base_fare,
    (CASE
       WHEN cm.ride_type = 'one_way' THEN GREATEST(cm.distance_fare + cm.time_fare, cm.min_fare)
       WHEN cm.ride_type = 'round_trip' THEN GREATEST(cm.distance_fare + cm.overage_fare, cm.min_fare) + cm.hour_surcharge
       ELSE cm.rental_base + cm.overage_fare
     END) AS subtotal
  FROM components cm
),
ins AS (
  INSERT INTO fare_snapshots (
    ride_id, rate_card_id, rental_package_id, ride_type, is_return_cab, surge_multiplier,
    estimated_km, estimated_min, stop_count, trip_hours,
    actual_km, actual_min, overage_km, overage_min,
    base_fare, distance_fare, time_fare, stop_fare, hour_surcharge, overage_fare, surge_fare,
    total_estimated, total_final, status, finalised_at
  )
  SELECT
    t.ride_id, t.rate_card_id, t.rental_package_id, t.ride_type, t.is_return_cab, t.surge_multiplier,
    round(t.estimated_km::numeric, 2), round(t.estimated_min::numeric, 2), 0, COALESCE(t.trip_hours, 0),
    t.actual_distance_km, t.actual_duration_min, 0, 0,
    round(t.base_fare::numeric, 2), t.distance_fare, t.time_fare, 0.00, t.hour_surcharge, t.overage_fare,
    round((t.subtotal * (t.surge_multiplier - 1))::numeric, 2),
    round((t.subtotal * t.surge_multiplier)::numeric, 2),
    CASE WHEN t.status = 'completed' THEN round((t.subtotal * t.surge_multiplier)::numeric, 2) END,
    (CASE WHEN t.status = 'completed' THEN 'final' ELSE 'estimate' END)::fare_status,
    CASE WHEN t.status = 'completed' THEN t.completed_at END
  FROM totals t
  RETURNING id, ride_id, total_final, finalised_at
)
SELECT * FROM ins;

\echo 'Fare snapshots inserted.'

-- ── 6. Payments (completed rides only — driver_id is NOT NULL) ───────
INSERT INTO payments (
  ride_id, user_id, driver_id, fare_snapshot_id, amount, currency, channel, status,
  commission_percent, commission_amount, driver_earning, captured_at
)
WITH src AS (
  SELECT
    tr.id AS ride_id, tr.user_id, tr.driver_id,
    tf.id AS fare_id, tf.total_final AS amount, tf.finalised_at,
    random() AS r_channel, random() AS r_status
  FROM t_rides tr
  JOIN t_fares tf ON tf.ride_id = tr.id
  WHERE tr.status = 'completed'
)
SELECT
  ride_id, user_id, driver_id, fare_id, amount, 'INR',
  (CASE WHEN r_channel < 0.30 THEN 'online_upi'
        WHEN r_channel < 0.55 THEN 'razorpay_online'
        WHEN r_channel < 0.75 THEN 'cash_direct'
        WHEN r_channel < 0.85 THEN 'online_card'
        WHEN r_channel < 0.90 THEN 'company_qr'
        WHEN r_channel < 0.95 THEN 'online_wallet'
        ELSE 'platform_wallet' END)::payment_channel,
  (CASE WHEN r_status < 0.95 THEN 'completed'
        WHEN r_status < 0.98 THEN 'partially_refunded'
        ELSE 'refunded' END)::payment_status,
  15.00,
  round((amount * 0.15)::numeric, 2),
  round((amount * 0.85)::numeric, 2),
  finalised_at
FROM src;

\echo 'Payments inserted.'

-- ── 7. Ride status history ────────────────────────────────────────────
-- One chain per ride, truncated to however far it actually progressed
-- (mirrors the timestamps already committed on the rides row).
-- Every literal below is cast explicitly (::ride_status / ::transition_actor)
-- rather than relying on cross-branch type inference — a plain string
-- literal in a UNION ALL only picks up the enum type automatically if some
-- other branch already supplies a concrete (non-text) type for that column;
-- leaving even one branch uncast resolves the whole UNION's column to text,
-- which Postgres then refuses to assign to an enum column on INSERT.
INSERT INTO ride_status_history (ride_id, from_status, to_status, actor, created_at)
SELECT tr.id, NULL::ride_status, 'requested'::ride_status, 'user'::transition_actor, tr.requested_at
FROM t_rides tr
UNION ALL
SELECT tr.id, 'requested'::ride_status, 'accepted'::ride_status, 'driver'::transition_actor, tr.accepted_at
FROM t_rides tr WHERE tr.accepted_at IS NOT NULL
UNION ALL
SELECT tr.id, 'accepted'::ride_status, 'driver_arrived'::ride_status, 'driver'::transition_actor, tr.driver_arrived_at
FROM t_rides tr WHERE tr.driver_arrived_at IS NOT NULL
UNION ALL
SELECT tr.id, 'driver_arrived'::ride_status, 'in_progress'::ride_status, 'driver'::transition_actor, tr.started_at
FROM t_rides tr WHERE tr.started_at IS NOT NULL
UNION ALL
SELECT tr.id, 'in_progress'::ride_status, 'completed'::ride_status, 'ride_completion'::transition_actor, tr.completed_at
FROM t_rides tr WHERE tr.status = 'completed'
UNION ALL
SELECT tr.id, 'requested'::ride_status, 'no_drivers'::ride_status, 'system'::transition_actor, tr.requested_at + interval '5 minutes'
FROM t_rides tr WHERE tr.status = 'no_drivers'
UNION ALL
SELECT
  tr.id,
  (CASE WHEN tr.started_at IS NOT NULL THEN 'in_progress'
        WHEN tr.driver_arrived_at IS NOT NULL THEN 'driver_arrived'
        WHEN tr.accepted_at IS NOT NULL THEN 'accepted'
        ELSE 'requested' END)::ride_status,
  'cancelled'::ride_status,
  tc.actor::text::transition_actor,
  tr.cancelled_at
FROM t_rides tr
JOIN t_cancellations tc ON tc.ride_id = tr.id
WHERE tr.status = 'cancelled';

\echo 'Ride status history inserted.'

-- ── 8. Ratings (completed rides only; not every ride gets rated) ─────
INSERT INTO ratings (ride_id, direction, score, from_user_id, from_driver_id, to_user_id, to_driver_id, created_at)
WITH src AS (
  SELECT
    tr.id AS ride_id, tr.user_id, tr.driver_id, tr.completed_at,
    random() AS r_u2d, random() AS r_d2u, random() AS r_score_u, random() AS r_score_d
  FROM t_rides tr WHERE tr.status = 'completed'
)
SELECT
  ride_id, 'user_to_driver'::rating_direction,
  (CASE WHEN r_score_u < 0.65 THEN 5 WHEN r_score_u < 0.90 THEN 4
        WHEN r_score_u < 0.97 THEN 3 WHEN r_score_u < 0.99 THEN 2 ELSE 1 END)::smallint,
  user_id, NULL, NULL, driver_id, completed_at
FROM src WHERE r_u2d < 0.85
UNION ALL
SELECT
  ride_id, 'driver_to_user'::rating_direction,
  (CASE WHEN r_score_d < 0.70 THEN 5 WHEN r_score_d < 0.92 THEN 4
        WHEN r_score_d < 0.98 THEN 3 ELSE 2 END)::smallint,
  NULL, driver_id, user_id, NULL, completed_at
FROM src WHERE r_d2u < 0.70;

\echo 'Ratings inserted.'

-- ── 9. Summary ─────────────────────────────────────────────────────────
SELECT 'users (synthetic)'  AS table_name, count(*) FROM users WHERE phone LIKE '+919999%'
UNION ALL SELECT 'rides',               (SELECT count(*) FROM t_rides)
UNION ALL SELECT 'ride_status_history', (SELECT count(*) FROM ride_status_history WHERE ride_id IN (SELECT id FROM t_rides))
UNION ALL SELECT 'fare_snapshots',      (SELECT count(*) FROM t_fares)
UNION ALL SELECT 'payments',            (SELECT count(*) FROM payments WHERE ride_id IN (SELECT id FROM t_rides))
UNION ALL SELECT 'ride_cancellations',  (SELECT count(*) FROM t_cancellations)
UNION ALL SELECT 'ratings',             (SELECT count(*) FROM ratings WHERE ride_id IN (SELECT id FROM t_rides));

\echo 'Done.'
\echo 'Cleanup (run when this test data is no longer needed):'
\echo '  DELETE FROM ratings WHERE ride_id IN (SELECT id FROM rides WHERE user_id IN (SELECT id FROM users WHERE phone LIKE ''+919999%''));'
\echo '  DELETE FROM ride_cancellations WHERE ride_id IN (SELECT id FROM rides WHERE user_id IN (SELECT id FROM users WHERE phone LIKE ''+919999%''));'
\echo '  DELETE FROM payments WHERE ride_id IN (SELECT id FROM rides WHERE user_id IN (SELECT id FROM users WHERE phone LIKE ''+919999%''));'
\echo '  DELETE FROM ride_status_history WHERE ride_id IN (SELECT id FROM rides WHERE user_id IN (SELECT id FROM users WHERE phone LIKE ''+919999%''));'
\echo '  DELETE FROM fare_snapshots WHERE ride_id IN (SELECT id FROM rides WHERE user_id IN (SELECT id FROM users WHERE phone LIKE ''+919999%''));'
\echo '  DELETE FROM rides WHERE user_id IN (SELECT id FROM users WHERE phone LIKE ''+919999%'');'
\echo '  DELETE FROM users WHERE phone LIKE ''+919999%'';'
