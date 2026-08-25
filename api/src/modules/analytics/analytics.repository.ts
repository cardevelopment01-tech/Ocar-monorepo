import { pool } from '@/db/client'
import type { QueryResultRow } from 'pg'
import type {
  DailyRevenue, RideFunnel, TopDriver,
  CityBreakdown, CategoryBreakdown, EtaAccuracy,
  DriverOnboardingFunnel, DriverAvailability,
} from './analytics.types'

// Analytics are heavy GROUP-BY scans that legitimately exceed the 10s OLTP
// statement_timeout at scale. Raise it per-query via SET LOCAL — transaction-
// scoped, reverts on COMMIT, never leaks onto wallet/ride queries sharing the pool.
async function analyticsQuery<T extends QueryResultRow>(
  text: string, params: unknown[], timeoutMs = 60_000
): Promise<T[]> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`) // Number()-coerced — never user input, no injection surface
    const res = await client.query<T>(text, params)
    await client.query('COMMIT')
    return res.rows
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function getDailyRevenue(days: number): Promise<DailyRevenue[]> {
  const rows = await analyticsQuery<{ day: Date; revenue: string; ride_count: string }>(
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
  return rows.map(r => ({
    day:        r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
    revenue:    parseFloat(r.revenue),
    ride_count: parseInt(r.ride_count, 10),
  }))
}

export async function getRideFunnel(days: number): Promise<RideFunnel> {
  const rows = await analyticsQuery<{
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
  const r = rows[0]
  if (!r) return { requested: 0, accepted: 0, completed: 0, cancelled: 0 }
  return {
    requested: parseInt(r.requested, 10),
    accepted:  parseInt(r.accepted,  10),
    completed: parseInt(r.completed, 10),
    cancelled: parseInt(r.cancelled, 10),
  }
}

export async function getTopDrivers(days: number): Promise<TopDriver[]> {
  const rows = await analyticsQuery<QueryResultRow>(
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
  return rows.map(r => ({
    driver_id:      r.driver_id as string,
    driver_name:    r.driver_name as string | null,
    driver_code:    r.driver_code as string,
    trip_count:     parseInt(r.trip_count as string, 10),
    total_earnings: parseFloat(r.total_earnings as string),
    rating_avg:     r.rating_avg as string | null,
  }))
}

export async function getCityBreakdown(days: number): Promise<CityBreakdown[]> {
  const rows = await analyticsQuery<QueryResultRow>(
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
  return rows.map(r => ({
    city_name:  r.city_name as string,
    ride_count: parseInt(r.ride_count as string, 10),
    revenue:    parseFloat(r.revenue as string),
  }))
}

export async function getCategoryBreakdown(days: number): Promise<CategoryBreakdown[]> {
  const rows = await analyticsQuery<QueryResultRow>(
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
  return rows.map(r => ({
    category_name: r.category_name as string,
    ride_count:    parseInt(r.ride_count as string, 10),
    revenue:       parseFloat(r.revenue as string),
  }))
}

// Routing-engine ETA accuracy vs actual elapsed time, per corridor/leg — see
// docs/PRODUCTION_NAVIGATION_SYSTEM_PLAN.md Phase 4. Actuals are derived from
// rides' existing transition timestamps, not stored redundantly.
export async function getEtaAccuracy(days: number): Promise<EtaAccuracy[]> {
  const rows = await analyticsQuery<QueryResultRow>(
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
  return rows.map(r => ({
    origin_city:      r.origin_city as string | null,
    destination_city: r.destination_city as string | null,
    leg:              r.leg as 'to_pickup' | 'to_destination',
    sample_count:     parseInt(r.sample_count as string, 10),
    mae_min:          parseFloat(r.mae_min as string),
    mape_pct:         r.mape_pct == null ? null : parseFloat(r.mape_pct as string),
  }))
}

// Onboarding stages come from driver_status_history — every transition is
// already logged there, no dedicated timestamp columns needed on drivers.
export async function getDriverOnboardingFunnel(days: number): Promise<DriverOnboardingFunnel[]> {
  const rows = await analyticsQuery<QueryResultRow>(
    `SELECT
       COALESCE(c.name, 'Unassigned')                             AS city_name,
       COUNT(*)                                                   AS signed_up,
       COUNT(*) FILTER (WHERE docs.driver_id IS NOT NULL)         AS docs_submitted,
       COUNT(*) FILTER (WHERE active.driver_id IS NOT NULL)       AS activated,
       COUNT(*) FILTER (WHERE d.status IN ('suspended','banned')) AS rejected_or_banned,
       AVG(EXTRACT(EPOCH FROM (active.activated_at - d.created_at)) / 3600)
         FILTER (WHERE active.driver_id IS NOT NULL)              AS avg_hours_to_active
     FROM drivers d
     LEFT JOIN cities c ON c.id = d.city_id
     LEFT JOIN LATERAL (
       SELECT DISTINCT ON (h.driver_id) h.driver_id
       FROM driver_status_history h
       WHERE h.driver_id = d.id AND h.to_status = 'pending_approval'
     ) docs ON true
     LEFT JOIN LATERAL (
       SELECT h.driver_id, h.created_at AS activated_at
       FROM driver_status_history h
       WHERE h.driver_id = d.id AND h.to_status = 'active'
       ORDER BY h.created_at
       LIMIT 1
     ) active ON true
     WHERE d.created_at >= NOW() - ($1 || ' days')::INTERVAL
     GROUP BY c.name
     ORDER BY signed_up DESC`,
    [days]
  )
  return rows.map(r => {
    const signed_up = parseInt(r.signed_up as string, 10)
    const activated = parseInt(r.activated as string, 10)
    return {
      city_name:            r.city_name as string,
      signed_up,
      docs_submitted:       parseInt(r.docs_submitted as string, 10),
      activated,
      rejected_or_banned:   parseInt(r.rejected_or_banned as string, 10),
      avg_hours_to_active:  r.avg_hours_to_active == null ? null : parseFloat(r.avg_hours_to_active as string),
      conversion_pct:       signed_up > 0 ? (activated / signed_up) * 100 : 0,
    }
  })
}

// Live snapshot, not period-scoped — "is this driver actually on the road
// right now", not a historical count.
export async function getDriverAvailability(): Promise<DriverAvailability[]> {
  const rows = await analyticsQuery<QueryResultRow>(
    `SELECT
       COALESCE(c.name, 'Unassigned')                  AS city_name,
       COUNT(*) FILTER (WHERE d.status = 'active')      AS total_active,
       COUNT(*) FILTER (WHERE ds.id IS NOT NULL)         AS online_now,
       COUNT(*) FILTER (WHERE dls.is_available = true)   AS available_now
     FROM drivers d
     LEFT JOIN cities c ON c.id = d.city_id
     LEFT JOIN driver_sessions ds
       ON ds.driver_id = d.id AND ds.status IN ('online','on_trip') AND ds.went_offline_at IS NULL
     LEFT JOIN driver_location_snapshots dls ON dls.driver_id = d.id
     WHERE d.status = 'active'
     GROUP BY c.name
     ORDER BY total_active DESC`,
    []
  )
  return rows.map(r => {
    const total_active = parseInt(r.total_active as string, 10)
    const available_now = parseInt(r.available_now as string, 10)
    return {
      city_name:         r.city_name as string,
      total_active,
      online_now:        parseInt(r.online_now as string, 10),
      available_now,
      availability_pct:  total_active > 0 ? (available_now / total_active) * 100 : 0,
    }
  })
}
