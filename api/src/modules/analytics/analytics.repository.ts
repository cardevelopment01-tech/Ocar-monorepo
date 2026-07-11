import { pool } from '@/db/client'
import type {
  DailyRevenue, RideFunnel, TopDriver,
  CityBreakdown, CategoryBreakdown, EtaAccuracy,
} from './analytics.types'

export async function getDailyRevenue(days: number): Promise<DailyRevenue[]> {
  const res = await pool.query<{ day: Date; revenue: string; ride_count: string }>(
    `SELECT
       (r.requested_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
       COALESCE(SUM(p.amount), 0)                         AS revenue,
       COUNT(r.id)                                        AS ride_count
     FROM rides r
     LEFT JOIN payments p ON p.ride_id = r.id AND p.status = 'completed'
     WHERE r.requested_at >= NOW() - ($1 || ' days')::INTERVAL
       AND r.status = 'completed'
     GROUP BY day
     ORDER BY day`,
    [days]
  )
  return res.rows.map(r => ({
    day:        r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
    revenue:    parseFloat(r.revenue),
    ride_count: parseInt(r.ride_count, 10),
  }))
}

export async function getRideFunnel(days: number): Promise<RideFunnel> {
  const res = await pool.query<{
    requested: string; accepted: string; completed: string; cancelled: string
  }>(
    `SELECT
       COUNT(*)                                                        AS requested,
       COUNT(*) FILTER (WHERE status NOT IN ('requested','cancelled')) AS accepted,
       COUNT(*) FILTER (WHERE status = 'completed')                   AS completed,
       COUNT(*) FILTER (WHERE status = 'cancelled')                   AS cancelled
     FROM rides
     WHERE requested_at >= NOW() - ($1 || ' days')::INTERVAL`,
    [days]
  )
  const r = res.rows[0]
  if (!r) return { requested: 0, accepted: 0, completed: 0, cancelled: 0 }
  return {
    requested: parseInt(r.requested, 10),
    accepted:  parseInt(r.accepted,  10),
    completed: parseInt(r.completed, 10),
    cancelled: parseInt(r.cancelled, 10),
  }
}

export async function getTopDrivers(days: number): Promise<TopDriver[]> {
  const res = await pool.query(
    `SELECT
       d.id::text          AS driver_id,
       d.full_name         AS driver_name,
       d.code              AS driver_code,
       COUNT(r.id)         AS trip_count,
       COALESCE(SUM(p.driver_earning), 0) AS total_earnings,
       d.rating_avg::text
     FROM drivers d
     JOIN rides r ON r.driver_id = d.id AND r.status = 'completed'
       AND r.completed_at >= NOW() - ($1 || ' days')::INTERVAL
     LEFT JOIN payments p ON p.ride_id = r.id
     GROUP BY d.id, d.full_name, d.code, d.rating_avg
     ORDER BY total_earnings DESC NULLS LAST
     LIMIT 10`,
    [days]
  )
  return res.rows.map(r => ({
    driver_id:      r.driver_id as string,
    driver_name:    r.driver_name as string | null,
    driver_code:    r.driver_code as string,
    trip_count:     parseInt(r.trip_count as string, 10),
    total_earnings: parseFloat(r.total_earnings as string),
    rating_avg:     r.rating_avg as string | null,
  }))
}

export async function getCityBreakdown(days: number): Promise<CityBreakdown[]> {
  const res = await pool.query(
    `SELECT
       c.name             AS city_name,
       COUNT(r.id)        AS ride_count,
       COALESCE(SUM(p.amount), 0) AS revenue
     FROM cities c
     LEFT JOIN rides r ON r.origin_city_id = c.id AND r.status = 'completed'
       AND r.requested_at >= NOW() - ($1 || ' days')::INTERVAL
     LEFT JOIN payments p ON p.ride_id = r.id AND p.status = 'completed'
     GROUP BY c.id, c.name
     ORDER BY ride_count DESC`,
    [days]
  )
  return res.rows.map(r => ({
    city_name:  r.city_name as string,
    ride_count: parseInt(r.ride_count as string, 10),
    revenue:    parseFloat(r.revenue as string),
  }))
}

export async function getCategoryBreakdown(days: number): Promise<CategoryBreakdown[]> {
  const res = await pool.query(
    `SELECT
       vc.display_name    AS category_name,
       COUNT(r.id)        AS ride_count,
       COALESCE(SUM(p.amount), 0) AS revenue
     FROM vehicle_categories vc
     LEFT JOIN rides r ON r.category_id = vc.id AND r.status = 'completed'
       AND r.requested_at >= NOW() - ($1 || ' days')::INTERVAL
     LEFT JOIN payments p ON p.ride_id = r.id AND p.status = 'completed'
     GROUP BY vc.id, vc.display_name
     ORDER BY ride_count DESC`,
    [days]
  )
  return res.rows.map(r => ({
    category_name: r.category_name as string,
    ride_count:    parseInt(r.ride_count as string, 10),
    revenue:       parseFloat(r.revenue as string),
  }))
}

// Routing-engine ETA accuracy vs actual elapsed time, per corridor/leg — see
// docs/PRODUCTION_NAVIGATION_SYSTEM_PLAN.md Phase 4. Actuals are derived from
// rides' existing transition timestamps, not stored redundantly.
export async function getEtaAccuracy(days: number): Promise<EtaAccuracy[]> {
  const res = await pool.query(
    `SELECT
       oc.name AS origin_city,
       dc.name AS destination_city,
       s.leg,
       COUNT(*) AS sample_count,
       AVG(ABS(s.predicted_duration_min - actual.actual_min)) AS mae_min,
       AVG(ABS(s.predicted_duration_min - actual.actual_min) / NULLIF(actual.actual_min, 0)) * 100 AS mape_pct
     FROM ride_eta_snapshots s
     JOIN rides r ON r.id = s.ride_id
     LEFT JOIN cities oc ON oc.id = r.origin_city_id
     LEFT JOIN cities dc ON dc.id = r.destination_city_id
     CROSS JOIN LATERAL (
       SELECT CASE s.leg
         WHEN 'to_pickup'      THEN EXTRACT(EPOCH FROM (r.driver_arrived_at - r.accepted_at)) / 60
         WHEN 'to_destination' THEN EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) / 60
       END AS actual_min
     ) actual
     WHERE r.requested_at >= NOW() - ($1 || ' days')::INTERVAL
       AND actual.actual_min IS NOT NULL
     GROUP BY oc.name, dc.name, s.leg
     ORDER BY oc.name, dc.name, s.leg`,
    [days]
  )
  return res.rows.map(r => ({
    origin_city:      r.origin_city as string | null,
    destination_city: r.destination_city as string | null,
    leg:              r.leg as 'to_pickup' | 'to_destination',
    sample_count:     parseInt(r.sample_count as string, 10),
    mae_min:          parseFloat(r.mae_min as string),
    mape_pct:         r.mape_pct == null ? null : parseFloat(r.mape_pct as string),
  }))
}
