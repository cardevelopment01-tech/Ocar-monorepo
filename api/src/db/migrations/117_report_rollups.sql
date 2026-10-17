-- Report rollups: pre-aggregated per-IST-day tables so the Reports / Analytics pages stay fast as rides grow.
-- Evidence: load-tests/LARGE_DATA_QUERY_REPORT.xlsx (F8). At 1M rides the 365-day reports scanned ~770k completed
-- rides + payments on every page view (0.8-3 s, up to 8.7 s for the city breakdown on a 2-vCPU box); from these
-- tables they read a few thousand rows (1-110 ms). Results were identical to the raw queries.
--
-- Shape: materialized views, one row per IST day x dimension. Days before the last refresh are read from here;
-- the days since (normally just today) are read from the raw tables, so numbers are live. The views are refreshed
-- hourly by the 'refresh_report_rollups' job (REFRESH ... CONCURRENTLY: reads are never blocked; needs the unique
-- indexes below) and `rpt_rollup_meta` records when each refresh STARTED, which is the safe cutoff day.
-- IST day = (timestamptz AT TIME ZONE 'Asia/Kolkata')::date, the same clock the reports use.
-- Plain CREATE MATERIALIZED VIEW populates inside migrate.ts's transaction: it only READS rides/payments/
-- ride_assignments (no write lock on them). Expect a few seconds per view at ~1M rides.

-- completed rides by completion day: revenue, commission, earnings, completed counts, finance split
CREATE MATERIALIZED VIEW IF NOT EXISTS rpt_completed AS
  SELECT (r.completed_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
         COALESCE(r.origin_city_id, 0) AS city_id,
         r.category_id,
         COALESCE(p.channel::text, 'none') AS channel,
         COUNT(*)::int AS n_rides,
         COALESCE(SUM(p.amount)            FILTER (WHERE p.status = 'completed'), 0)::numeric(14,2) AS gross,
         COALESCE(SUM(p.commission_amount) FILTER (WHERE p.status = 'completed'), 0)::numeric(14,2) AS commission,
         COALESCE(SUM(p.driver_earning)    FILTER (WHERE p.status = 'completed'), 0)::numeric(14,2) AS driver_earning
    FROM rides r LEFT JOIN payments p ON p.ride_id = r.id
   WHERE r.status = 'completed' AND r.completed_at IS NOT NULL
   GROUP BY 1, 2, 3, 4;
CREATE UNIQUE INDEX IF NOT EXISTS rpt_completed_uidx ON rpt_completed (day, city_id, category_id, channel);

-- completed rides by completion day and driver: top drivers, active drivers
CREATE MATERIALIZED VIEW IF NOT EXISTS rpt_driver AS
  SELECT (r.completed_at AT TIME ZONE 'Asia/Kolkata')::date AS day, r.driver_id,
         COUNT(*)::int AS n_rides,
         COALESCE(SUM(p.driver_earning) FILTER (WHERE p.status = 'completed'), 0)::numeric(14,2) AS earnings
    FROM rides r LEFT JOIN payments p ON p.ride_id = r.id
   WHERE r.status = 'completed' AND r.completed_at IS NOT NULL AND r.driver_id IS NOT NULL
   GROUP BY 1, 2;
CREATE UNIQUE INDEX IF NOT EXISTS rpt_driver_uidx ON rpt_driver (day, driver_id);

-- every ride by REQUEST day and status: funnel, cohort rates, daily cohort series, city cancellations
CREATE MATERIALIZED VIEW IF NOT EXISTS rpt_requested AS
  SELECT (r.requested_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
         COALESCE(r.origin_city_id, 0) AS city_id, r.category_id, r.status::text AS status,
         COUNT(*)::int AS n
    FROM rides r
   GROUP BY 1, 2, 3, 4;
CREATE UNIQUE INDEX IF NOT EXISTS rpt_requested_uidx ON rpt_requested (day, city_id, category_id, status);

-- rides by request day, hour and city: demand heatmap
CREATE MATERIALIZED VIEW IF NOT EXISTS rpt_heat AS
  SELECT (r.requested_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
         EXTRACT(HOUR FROM r.requested_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
         COALESCE(r.origin_city_id, 0) AS city_id, COUNT(*)::int AS n
    FROM rides r
   GROUP BY 1, 2, 3;
CREATE UNIQUE INDEX IF NOT EXISTS rpt_heat_uidx ON rpt_heat (day, hour, city_id);

-- cancellations by REQUEST day, actor, stage, reason and city
CREATE MATERIALIZED VIEW IF NOT EXISTS rpt_cancel AS
  SELECT (r.requested_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
         c.actor::text AS actor, c.stage::text AS stage, COALESCE(c.reason_code, 'unspecified') AS reason_code,
         COALESCE(r.origin_city_id, 0) AS city_id, COUNT(*)::int AS n
    FROM ride_cancellations c JOIN rides r ON r.id = c.ride_id
   GROUP BY 1, 2, 3, 4, 5;
CREATE UNIQUE INDEX IF NOT EXISTS rpt_cancel_uidx ON rpt_cancel (day, actor, stage, reason_code, city_id);

-- a driver's rides by REQUEST day: driver quality (completion / cancellation rate, earnings)
CREATE MATERIALIZED VIEW IF NOT EXISTS rpt_driver_req AS
  SELECT (r.requested_at AT TIME ZONE 'Asia/Kolkata')::date AS day, r.driver_id,
         COUNT(*) FILTER (WHERE r.status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE r.status = 'cancelled')::int AS cancelled,
         COALESCE(SUM(p.driver_earning) FILTER (WHERE r.status = 'completed' AND p.status = 'completed'), 0)::numeric(14,2) AS earnings
    FROM rides r LEFT JOIN payments p ON p.ride_id = r.id
   WHERE r.driver_id IS NOT NULL
   GROUP BY 1, 2;
CREATE UNIQUE INDEX IF NOT EXISTS rpt_driver_req_uidx ON rpt_driver_req (day, driver_id);

-- offers by OFFER day and driver: driver quality (acceptance rate)
CREATE MATERIALIZED VIEW IF NOT EXISTS rpt_offers AS
  SELECT (a.offered_at AT TIME ZONE 'Asia/Kolkata')::date AS day, a.driver_id,
         COUNT(*)::int AS offered, COUNT(*) FILTER (WHERE a.status = 'accepted')::int AS accepted
    FROM ride_assignments a
   GROUP BY 1, 2;
CREATE UNIQUE INDEX IF NOT EXISTS rpt_offers_uidx ON rpt_offers (day, driver_id);

-- One row: when the last refresh STARTED. Days before that moment's IST date are complete in the views.
-- Starts at the migration's own start time (conservative: the views were just populated from a later snapshot).
CREATE TABLE IF NOT EXISTS rpt_rollup_meta (
  id           SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  refreshed_at TIMESTAMPTZ NOT NULL
);
INSERT INTO rpt_rollup_meta (id, refreshed_at) VALUES (1, now())
  ON CONFLICT (id) DO NOTHING;

-- ROLLBACK:
--   DROP MATERIALIZED VIEW IF EXISTS rpt_completed, rpt_driver, rpt_requested, rpt_heat, rpt_cancel, rpt_driver_req, rpt_offers;
--   DROP TABLE IF EXISTS rpt_rollup_meta;
--   (the API falls back to the raw queries automatically when the meta row or the views are missing)
