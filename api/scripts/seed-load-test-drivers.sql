-- Synthetic driver top-up for the live traffic ramp — LOAD_TEST_PLAN.md §3
-- amendment (production currently has ~200 active drivers, short of the
-- 400-driver concurrent target in §4).
--
-- SCOPE: this is ONLY for the live-traffic-ramp phase (§4) — an
-- infrastructure capacity question (can the ALB/ASG/Socket.io/connection
-- pool handle N concurrent driver sessions), not the historical
-- query-performance seed. The 1M-ride seed (seed-load-test-data.sql)
-- continues to use only real drivers, unaffected by this script.
--
-- Creates driver + driver_vehicles + driver_wallets rows only — deliberately
-- does NOT create driver_sessions. Going online is something the load-test
-- traffic tool itself does live against these accounts (same as a real
-- driver opening the app), not something to pre-seed.
--
-- SAFETY: every synthetic driver is tagged phone LIKE '+918888%' (own
-- reserved block, separate from the synthetic riders' +919999 block) so it's
-- always findable/deletable and never confused with a real driver account —
-- see LOAD_TEST_PLAN.md's amended §3/§9 for why this deviates from "reuse
-- real drivers only" and why that's scoped to this phase specifically.
--
-- REQUIRED BEFORE RUNNING ON STAGING: run
-- `SELECT count(*) FROM drivers WHERE phone LIKE '+918888%'` first and
-- confirm it's 0, same reasoning as the riders' +919999 check.
--
-- Usage:
--   psql "$DATABASE_URL" -f api/scripts/seed-load-test-drivers.sql
--   psql "$DATABASE_URL" -v target_concurrent_drivers=500 -f ...   -- different target
--
-- The synthetic count is computed at runtime as
-- GREATEST(0, target_concurrent_drivers - <current real active driver count>)
-- — so this script is safe to point at staging regardless of exactly how
-- many real active drivers exist there right now; it only ever tops up the
-- gap, never duplicates real drivers.
--
-- KNOWN GAP THIS SCRIPT DOES NOT SOLVE (same-day, not a seeding concern):
-- goOnline() (api/src/modules/rides/rides.service.ts) requires a
-- `driver_verifications` row for TODAY (daily_selfie + daily_plate, IST
-- calendar day) before any driver — real or synthetic — can go online. That
-- gate is inherently date-scoped and can't be pre-seeded days in advance.
-- Either the traffic-ramp tool itself submits daily verification through
-- the real endpoints as part of simulating each driver (most realistic), or
-- a same-day script inserts `driver_verifications` rows dated to the actual
-- test day for all 400 ramp drivers (real + synthetic) immediately before
-- the session starts. Flag this to the client before the live session —
-- without it, every single goOnline() call in the ramp fails at the first
-- gate, real drivers included.

\if :{?target_concurrent_drivers}
\else
  \set target_concurrent_drivers 400
\endif

\echo 'Seeding synthetic driver top-up...'

-- ── 0. Preflight ──────────────────────────────────────────────────────
DO $$
DECLARE
  city_count INT;
  cat_count  INT;
BEGIN
  SELECT count(*) INTO city_count FROM cities WHERE slug IN ('bhubaneswar', 'cuttack');
  IF city_count < 2 THEN
    RAISE EXCEPTION 'Expected cities "bhubaneswar" and "cuttack" to exist — run migrations first.';
  END IF;

  SELECT count(*) INTO cat_count FROM vehicle_categories;
  IF cat_count = 0 THEN
    RAISE EXCEPTION 'No vehicle_categories found — run migrations first.';
  END IF;
END $$;

-- ── 1. Synthetic drivers, vehicles, wallets ───────────────────────────
CREATE TEMP TABLE t_synthetic_drivers AS
WITH gap AS (
  SELECT GREATEST(0, :target_concurrent_drivers - (SELECT count(*) FROM drivers WHERE status = 'active')) AS n
),
ref_ids AS (
  SELECT
    (SELECT id FROM cities WHERE slug = 'bhubaneswar')          AS bbsr_id,
    (SELECT id FROM cities WHERE slug = 'cuttack')              AS ctc_id,
    (SELECT id FROM vehicle_categories WHERE slug = 'sedan')     AS sedan_id,
    (SELECT id FROM vehicle_categories WHERE slug = 'hatchback') AS hatchback_id,
    (SELECT id FROM vehicle_categories WHERE slug = 'suv')       AS suv_id,
    (SELECT id FROM vehicle_categories WHERE slug = 'van')       AS van_id,
    (SELECT id FROM vehicle_categories WHERE slug = 'luxury')    AS luxury_id
),
draws AS (
  SELECT i, random() AS r_city, random() AS r_cat, random() AS r_model
  FROM gap, generate_series(1, gap.n) AS i
),
picks AS (
  SELECT
    d.i,
    CASE WHEN d.r_city < 0.70 THEN r.bbsr_id ELSE r.ctc_id END AS city_id,
    CASE WHEN d.r_cat < 0.40 THEN r.sedan_id
         WHEN d.r_cat < 0.70 THEN r.hatchback_id
         WHEN d.r_cat < 0.90 THEN r.suv_id
         WHEN d.r_cat < 0.97 THEN r.van_id
         ELSE r.luxury_id END AS category_id,
    d.r_model
  FROM draws d
  CROSS JOIN ref_ids r
),
ins_drivers AS (
  INSERT INTO drivers (phone, full_name, status, onboarding_step, city_id)
  SELECT
    '+918888' || lpad(p.i::text, 6, '0'),
    'LT Driver ' || p.i,
    'active',
    'completed',
    p.city_id
  FROM picks p
  -- category_id isn't a drivers column, so it can't come back via RETURNING
  -- directly — but `i` is deterministically recoverable from the phone we
  -- just wrote (position 8 onward is the zero-padded i), which is safer
  -- than assuming INSERT...SELECT preserves row order back to `picks`.
  RETURNING id AS driver_id, phone, city_id, (substring(phone from 8))::int AS i
)
SELECT di.driver_id, di.phone, di.city_id, p.category_id
FROM ins_drivers di
JOIN picks p ON p.i = di.i;

\echo 'Synthetic driver accounts inserted.'

CREATE TEMP TABLE t_synthetic_vehicles AS
WITH picks AS (
  SELECT
    sd.driver_id, sd.category_id,
    (SELECT vm.id FROM vehicle_models vm
     WHERE vm.typical_category_id = sd.category_id
     ORDER BY random() LIMIT 1) AS model_id
  FROM t_synthetic_drivers sd
),
ins AS (
  INSERT INTO driver_vehicles (driver_id, category_id, model_id, vehicle_name, number_plate, status, is_primary)
  SELECT
    p.driver_id, p.category_id, p.model_id,
    'LT Test Vehicle',
    'LT-' || lpad(p.driver_id::text, 8, '0'),
    'active',
    true
  FROM picks p
  RETURNING id, driver_id
)
SELECT * FROM ins;

\echo 'Synthetic vehicles inserted.'

-- Funded well above any plausible driver_minimum_balance so the go-online
-- wallet gate (rides.service.ts goOnline(), commission-mode cities only —
-- both bhubaneswar and cuttack are commission-mode) never blocks these
-- accounts regardless of whatever that config value is on staging.
INSERT INTO driver_wallets (driver_id, balance)
SELECT driver_id, 2000.00 FROM t_synthetic_drivers;

INSERT INTO driver_package_wallets (driver_id, balance)
SELECT driver_id, 0 FROM t_synthetic_drivers;

\echo 'Driver wallets inserted.'

-- ── 2. Summary ─────────────────────────────────────────────────────────
SELECT 'synthetic drivers'     AS what, count(*) FROM t_synthetic_drivers
UNION ALL SELECT 'synthetic vehicles', count(*) FROM t_synthetic_vehicles
UNION ALL SELECT 'real active drivers (existing)', (SELECT count(*) FROM drivers WHERE status = 'active' AND phone NOT LIKE '+918888%')
UNION ALL SELECT 'total active drivers now', (SELECT count(*) FROM drivers WHERE status = 'active');

\echo 'Done.'
\echo 'REMINDER: same-day driver_verifications rows are still required before any of these drivers (real or synthetic) can go online — see the header comment.'
\echo 'Cleanup (run when this test data is no longer needed):'
\echo '  DELETE FROM driver_wallets WHERE driver_id IN (SELECT id FROM drivers WHERE phone LIKE ''+918888%'');'
\echo '  DELETE FROM driver_package_wallets WHERE driver_id IN (SELECT id FROM drivers WHERE phone LIKE ''+918888%'');'
\echo '  DELETE FROM driver_vehicles WHERE driver_id IN (SELECT id FROM drivers WHERE phone LIKE ''+918888%'');'
\echo '  DELETE FROM drivers WHERE phone LIKE ''+918888%'';'
