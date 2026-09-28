import { analyticsPool } from '@/db/client'
import type { QueryResultRow } from 'pg'
import type {
  DailyPoint, RideFunnel, TopDriver, DriverQuality,
  CityBreakdown, CategoryBreakdown, EtaAccuracy,
  DriverOnboardingFunnel, DriverAvailability,
  FinanceTotals, CashDiscrepancyPanel, CancellationRow, HeatmapCell,
} from './analytics.types'
import {
  kpiTotalsSql, parseKpiTotals, ridesFilterSql,
  type KpiFilters, type KpiTotals, type TimeRange,
} from './kpi-definitions'

// Analytics are heavy GROUP-BY scans that legitimately exceed the 10s OLTP
// statement_timeout at scale. Raise it per-query via SET LOCAL — transaction-
// scoped, reverts on COMMIT. They run on the dedicated `analyticsPool` (eng D7, max 4) so a
// busy Reports page or the digest can never starve ride/payment connections.
export async function analyticsQuery<T extends QueryResultRow>(
  text: string, params: unknown[], timeoutMs = 60_000
): Promise<T[]> {
  const client = await analyticsPool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`) // Number()-coerced — never user input, no injection surface
    const res = await client.query<T>(text, params)
    await client.query('COMMIT')
    return res.rows
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw e
  } finally {
    client.release()
  }
}

const bounds = (r: TimeRange): [string, string] => [r.start.toISOString(), r.end.toISOString()]
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

// ── KPI totals (shared definitions, kpi-definitions.ts) ───────────────────────
export async function getKpiTotals(range: TimeRange, filters?: KpiFilters): Promise<KpiTotals> {
  const f = ridesFilterSql(filters, 3)
  const rows = await analyticsQuery<QueryResultRow>(kpiTotalsSql('$1', '$2', f.sql), [...bounds(range), ...f.params])
  return parseKpiTotals(rows[0])
}

// One point per IST day: money and completed rides by completed_at, the requested cohort by requested_at.
export async function getDailySeries(range: TimeRange, filters?: KpiFilters): Promise<DailyPoint[]> {
  const f = ridesFilterSql(filters, 3)
  const rows = await analyticsQuery<QueryResultRow>(
    `WITH days AS (
       SELECT d::date AS day
         FROM generate_series(($1::timestamptz AT TIME ZONE 'Asia/Kolkata')::date,
                              (($2::timestamptz - interval '1 second') AT TIME ZONE 'Asia/Kolkata')::date,
                              interval '1 day') d
     ),
     done AS (
       SELECT (r.completed_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
              COUNT(*) AS completed_rides,
              COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'completed'), 0) AS gross,
              COALESCE(SUM(p.commission_amount) FILTER (WHERE p.status = 'completed'), 0) AS commission
         FROM rides r LEFT JOIN payments p ON p.ride_id = r.id
        WHERE r.status = 'completed' AND r.completed_at >= $1 AND r.completed_at < $2 ${f.sql}
        GROUP BY 1
     ),
     req AS (
       SELECT (r.requested_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
              COUNT(*) FILTER (WHERE r.status = 'completed') AS cohort_completed,
              COUNT(*) FILTER (WHERE r.status = 'cancelled') AS cohort_cancelled
         FROM rides r
        WHERE r.status IN ('completed','cancelled') AND r.requested_at >= $1 AND r.requested_at < $2 ${f.sql}
        GROUP BY 1
     )
     SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
            COALESCE(done.completed_rides, 0) AS completed_rides,
            COALESCE(done.gross, 0) AS gross,
            COALESCE(done.commission, 0) AS commission,
            COALESCE(req.cohort_completed, 0) AS cohort_completed,
            COALESCE(req.cohort_cancelled, 0) AS cohort_cancelled
       FROM days
       LEFT JOIN done ON done.day = days.day
       LEFT JOIN req ON req.day = days.day
      ORDER BY days.day`,
    [...bounds(range), ...f.params]
  )
  return rows.map(r => ({
    day: r['day'] as string,
    completed_rides: num(r['completed_rides']),
    gross: num(r['gross']),
    commission: num(r['commission']),
    cohort_completed: num(r['cohort_completed']),
    cohort_cancelled: num(r['cohort_cancelled']),
  }))
}

export async function getRideFunnel(range: TimeRange, filters?: KpiFilters): Promise<RideFunnel> {
  const f = ridesFilterSql(filters, 3)
  const rows = await analyticsQuery<QueryResultRow>(
    `SELECT
       COUNT(*)                                                        AS requested,
       COUNT(*) FILTER (WHERE r.status NOT IN ('requested','cancelled')) AS accepted,
       COUNT(*) FILTER (WHERE r.status = 'completed')                   AS completed,
       COUNT(*) FILTER (WHERE r.status = 'cancelled')                   AS cancelled
     FROM rides r
     WHERE r.requested_at >= $1 AND r.requested_at < $2 ${f.sql}`,
    [...bounds(range), ...f.params]
  )
  const r = rows[0]
  return {
    requested: num(r?.['requested']), accepted: num(r?.['accepted']),
    completed: num(r?.['completed']), cancelled: num(r?.['cancelled']),
  }
}

// Top drivers by earnings; only completed payments count toward earnings (eng D5).
export async function getTopDrivers(range: TimeRange, filters?: KpiFilters): Promise<TopDriver[]> {
  const f = ridesFilterSql(filters, 3)
  const rows = await analyticsQuery<QueryResultRow>(
    `SELECT
       d.id::text          AS driver_id,
       d.full_name         AS driver_name,
       d.code              AS driver_code,
       COUNT(r.id)         AS trip_count,
       COALESCE(SUM(p.driver_earning) FILTER (WHERE p.status = 'completed'), 0) AS total_earnings,
       d.rating_avg::text
     FROM drivers d
     JOIN rides r ON r.driver_id = d.id AND r.status = 'completed'
       AND r.completed_at >= $1 AND r.completed_at < $2 ${f.sql}
     LEFT JOIN payments p ON p.ride_id = r.id
     GROUP BY d.id, d.full_name, d.code, d.rating_avg
     ORDER BY total_earnings DESC NULLS LAST
     LIMIT 10`,
    [...bounds(range), ...f.params]
  )
  return rows.map(r => ({
    driver_id: r['driver_id'] as string,
    driver_name: r['driver_name'] as string | null,
    driver_code: r['driver_code'] as string,
    trip_count: num(r['trip_count']),
    total_earnings: num(r['total_earnings']),
    rating_avg: r['rating_avg'] as string | null,
  }))
}

// Driver quality: acceptance from ride_assignments (offers in range), completion / cancel from
// the driver's rides requested in range. Sorted by completed trips; capped to keep the table light.
export async function getDriverQuality(range: TimeRange, filters?: KpiFilters, limit = 50): Promise<DriverQuality[]> {
  const f = ridesFilterSql(filters, 3)
  const rows = await analyticsQuery<QueryResultRow>(
    `WITH offers AS (
       SELECT a.driver_id,
              COUNT(*) AS offered,
              COUNT(*) FILTER (WHERE a.status = 'accepted') AS accepted
         FROM ride_assignments a
         JOIN rides r ON r.id = a.ride_id
        WHERE a.offered_at >= $1 AND a.offered_at < $2 ${f.sql}
        GROUP BY a.driver_id
     ),
     trips AS (
       SELECT r.driver_id,
              COUNT(*) FILTER (WHERE r.status = 'completed') AS completed,
              COUNT(*) FILTER (WHERE r.status = 'cancelled') AS cancelled,
              COALESCE(SUM(p.driver_earning) FILTER (WHERE r.status = 'completed' AND p.status = 'completed'), 0) AS earnings
         FROM rides r LEFT JOIN payments p ON p.ride_id = r.id
        WHERE r.driver_id IS NOT NULL AND r.requested_at >= $1 AND r.requested_at < $2 ${f.sql}
        GROUP BY r.driver_id
     )
     SELECT d.id::text AS driver_id, d.full_name AS driver_name, d.code AS driver_code, d.rating_avg::text AS rating_avg,
            COALESCE(o.offered, 0) AS offered, COALESCE(o.accepted, 0) AS accepted,
            COALESCE(t.completed, 0) AS completed, COALESCE(t.cancelled, 0) AS cancelled,
            COALESCE(t.earnings, 0) AS earnings
       FROM drivers d
       LEFT JOIN offers o ON o.driver_id = d.id
       LEFT JOIN trips t ON t.driver_id = d.id
      WHERE COALESCE(o.offered, 0) + COALESCE(t.completed, 0) + COALESCE(t.cancelled, 0) > 0
      ORDER BY COALESCE(t.completed, 0) DESC, COALESCE(o.offered, 0) DESC
      LIMIT ${Number(limit)}`,
    [...bounds(range), ...f.params]
  )
  return rows.map(r => {
    const offered = num(r['offered']), accepted = num(r['accepted'])
    const completed = num(r['completed']), cancelled = num(r['cancelled'])
    return {
      driver_id: r['driver_id'] as string,
      driver_name: r['driver_name'] as string | null,
      driver_code: r['driver_code'] as string,
      rating_avg: r['rating_avg'] as string | null,
      offered, accepted, completed, cancelled,
      acceptance_rate: offered === 0 ? null : accepted / offered,
      completion_rate: completed + cancelled === 0 ? null : completed / (completed + cancelled),
      cancellation_rate: completed + cancelled === 0 ? null : cancelled / (completed + cancelled),
      earnings: num(r['earnings']),
    }
  })
}

export async function getCityBreakdown(range: TimeRange, filters?: KpiFilters): Promise<CityBreakdown[]> {
  // City rows are always all cities; only the category filter applies (a city filter would empty the others).
  const catOnly = ridesFilterSql(filters?.categoryId !== undefined ? { categoryId: filters.categoryId } : undefined, 3)
  const rows = await analyticsQuery<QueryResultRow>(
    `SELECT
       c.name AS city_name,
       (SELECT COUNT(*) FROM rides r WHERE r.origin_city_id = c.id AND r.status = 'completed'
          AND r.completed_at >= $1 AND r.completed_at < $2 ${catOnly.sql}) AS ride_count,
       (SELECT COUNT(*) FROM rides r WHERE r.origin_city_id = c.id AND r.status = 'cancelled'
          AND r.requested_at >= $1 AND r.requested_at < $2 ${catOnly.sql}) AS cancelled_count,
       (SELECT COUNT(*) FROM rides r WHERE r.origin_city_id = c.id AND r.status = 'completed'
          AND r.requested_at >= $1 AND r.requested_at < $2 ${catOnly.sql}) AS cohort_completed,
       (SELECT COALESCE(SUM(p.amount), 0) FROM rides r JOIN payments p ON p.ride_id = r.id AND p.status = 'completed'
         WHERE r.origin_city_id = c.id AND r.status = 'completed'
           AND r.completed_at >= $1 AND r.completed_at < $2 ${catOnly.sql}) AS revenue,
       (SELECT COUNT(*) FROM drivers d WHERE d.city_id = c.id AND d.status = 'active') AS active_fleet
     FROM cities c
     ORDER BY ride_count DESC, c.name`,
    [...bounds(range), ...catOnly.params]
  )
  return rows.map(r => {
    const cancelled = num(r['cancelled_count']), cc = num(r['cohort_completed'])
    return {
      city_name: r['city_name'] as string,
      ride_count: num(r['ride_count']),
      revenue: num(r['revenue']),
      cancelled_count: cancelled,
      cancellation_rate: cc + cancelled === 0 ? 0 : cancelled / (cc + cancelled),
      active_drivers: num(r['active_fleet']), // active fleet snapshot, labelled "Active fleet" in the UI
    }
  })
}

export async function getCategoryBreakdown(range: TimeRange, filters?: KpiFilters): Promise<CategoryBreakdown[]> {
  const cityOnly = ridesFilterSql(filters?.cityIds ? { cityIds: filters.cityIds } : undefined, 3)
  const rows = await analyticsQuery<QueryResultRow>(
    `SELECT
       vc.display_name    AS category_name,
       COUNT(r.id)        AS ride_count,
       COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'completed'), 0) AS revenue
     FROM vehicle_categories vc
     LEFT JOIN rides r ON r.category_id = vc.id AND r.status = 'completed'
       AND r.completed_at >= $1 AND r.completed_at < $2 ${cityOnly.sql}
     LEFT JOIN payments p ON p.ride_id = r.id
     GROUP BY vc.id, vc.display_name
     ORDER BY ride_count DESC, vc.display_name`,
    [...bounds(range), ...cityOnly.params]
  )
  return rows.map(r => ({
    category_name: r['category_name'] as string,
    ride_count: num(r['ride_count']),
    revenue: num(r['revenue']),
  }))
}

// ── Finance (E3 cash panel, E4 refund / dispute rates, channel split) ─────────
export async function getFinanceTotals(range: TimeRange, filters?: KpiFilters): Promise<FinanceTotals> {
  const f = ridesFilterSql(filters, 3)
  const [split, refunds, disputes, completed] = await Promise.all([
    analyticsQuery<QueryResultRow>(
      `SELECT
         COALESCE(SUM(p.amount) FILTER (WHERE p.channel = 'cash_direct'), 0) AS cash,
         COALESCE(SUM(p.amount) FILTER (WHERE p.channel <> 'cash_direct'), 0) AS online,
         COALESCE(SUM(p.driver_earning), 0) AS driver_earnings
       FROM rides r JOIN payments p ON p.ride_id = r.id AND p.status = 'completed'
       WHERE r.status = 'completed' AND r.completed_at >= $1 AND r.completed_at < $2 ${f.sql}`,
      [...bounds(range), ...f.params]),
    // Event-window rate (working definition, finance to confirm): refunds completed in the range by processed_at.
    analyticsQuery<QueryResultRow>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(fr.amount), 0) AS amount
         FROM refunds fr JOIN rides r ON r.id = fr.ride_id
        WHERE fr.status = 'completed'
          AND COALESCE(fr.processed_at, fr.updated_at) >= $1 AND COALESCE(fr.processed_at, fr.updated_at) < $2 ${f.sql}`,
      [...bounds(range), ...f.params]),
    // Every dispute status except withdrawn, by created_at.
    analyticsQuery<QueryResultRow>(
      `SELECT COUNT(*) AS n
         FROM disputes dp JOIN rides r ON r.id = dp.ride_id
        WHERE dp.status <> 'withdrawn' AND dp.created_at >= $1 AND dp.created_at < $2 ${f.sql}`,
      [...bounds(range), ...f.params]),
    analyticsQuery<QueryResultRow>(
      `SELECT COUNT(*) AS n FROM rides r
        WHERE r.status = 'completed' AND r.completed_at >= $1 AND r.completed_at < $2 ${f.sql}`,
      [...bounds(range), ...f.params]),
  ])
  const completedRides = num(completed[0]?.['n'])
  const refundCount = num(refunds[0]?.['n']), disputeCount = num(disputes[0]?.['n'])
  return {
    cash_gross: num(split[0]?.['cash']),
    online_gross: num(split[0]?.['online']),
    driver_earnings: num(split[0]?.['driver_earnings']),
    refund_count: refundCount,
    refund_amount: num(refunds[0]?.['amount']),
    refunds_per_100: completedRides === 0 ? 0 : (refundCount / completedRides) * 100,
    dispute_count: disputeCount,
    disputes_per_100: completedRides === 0 ? 0 : (disputeCount / completedRides) * 100,
  }
}

// E3: rides flagged cash_discrepancy completed in range. Gap = fare - collected (positive = short).
export async function getCashDiscrepancy(range: TimeRange, filters?: KpiFilters): Promise<CashDiscrepancyPanel> {
  const f = ridesFilterSql(filters, 3)
  const rows = await analyticsQuery<QueryResultRow>(
    `SELECT
       COUNT(*) AS flagged,
       COUNT(*) FILTER (WHERE r.cash_collected_amount = 0) AS not_collected,
       COALESCE(SUM(p.amount - COALESCE(r.cash_collected_amount, 0)), 0) AS gap
     FROM rides r JOIN payments p ON p.ride_id = r.id
     WHERE r.cash_discrepancy = true AND r.completed_at >= $1 AND r.completed_at < $2 ${f.sql}`,
    [...bounds(range), ...f.params]
  )
  const gap = num(rows[0]?.['gap'])
  return {
    flagged_count: num(rows[0]?.['flagged']),
    not_collected_count: num(rows[0]?.['not_collected']),
    net_gap: gap, // positive = short, negative = over-collected
  }
}

export async function getCancellations(range: TimeRange, filters?: KpiFilters): Promise<CancellationRow[]> {
  const f = ridesFilterSql(filters, 3)
  const rows = await analyticsQuery<QueryResultRow>(
    `SELECT c.actor::text AS actor, c.stage::text AS stage, COALESCE(c.reason_code, 'unspecified') AS reason_code, COUNT(*) AS n
       FROM ride_cancellations c JOIN rides r ON r.id = c.ride_id
      WHERE r.requested_at >= $1 AND r.requested_at < $2 ${f.sql}
      GROUP BY 1, 2, 3
      ORDER BY n DESC
      LIMIT 20`,
    [...bounds(range), ...f.params]
  )
  return rows.map(r => ({
    actor: r['actor'] as string, stage: r['stage'] as string,
    reason_code: r['reason_code'] as string, count: num(r['n']),
  }))
}

// Rides requested per IST weekday (0 = Sunday) x hour.
export async function getDemandHeatmap(range: TimeRange, filters?: KpiFilters): Promise<HeatmapCell[]> {
  const f = ridesFilterSql(filters, 3)
  const rows = await analyticsQuery<QueryResultRow>(
    `SELECT EXTRACT(DOW FROM r.requested_at AT TIME ZONE 'Asia/Kolkata')::int AS dow,
            EXTRACT(HOUR FROM r.requested_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
            COUNT(*) AS n
       FROM rides r
      WHERE r.requested_at >= $1 AND r.requested_at < $2 ${f.sql}
      GROUP BY 1, 2`,
    [...bounds(range), ...f.params]
  )
  return rows.map(r => ({ dow: num(r['dow']), hour: num(r['hour']), count: num(r['n']) }))
}

// Routing-engine ETA accuracy vs actual elapsed time, per corridor/leg — see
// docs/PRODUCTION_NAVIGATION_SYSTEM_PLAN.md Phase 4. Actuals are derived from
// rides' existing transition timestamps, not stored redundantly.
export async function getEtaAccuracy(range: TimeRange): Promise<EtaAccuracy[]> {
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
     WHERE r.requested_at >= $1 AND r.requested_at < $2
       AND actual.actual_min IS NOT NULL
     GROUP BY oc.name, dc.name, s.leg
     ORDER BY oc.name, dc.name, s.leg`,
    bounds(range)
  )
  return rows.map(r => ({
    origin_city:      r['origin_city'] as string | null,
    destination_city: r['destination_city'] as string | null,
    leg:              r['leg'] as 'to_pickup' | 'to_destination',
    sample_count:     num(r['sample_count']),
    mae_min:          num(r['mae_min']),
    mape_pct:         r['mape_pct'] == null ? null : Number(r['mape_pct']),
  }))
}

// Onboarding stages come from driver_status_history — every transition is
// already logged there, no dedicated timestamp columns needed on drivers.
export async function getDriverOnboardingFunnel(range: TimeRange): Promise<DriverOnboardingFunnel[]> {
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
     WHERE d.created_at >= $1 AND d.created_at < $2
     GROUP BY c.name
     ORDER BY signed_up DESC`,
    bounds(range)
  )
  return rows.map(r => {
    const signed_up = num(r['signed_up'])
    const activated = num(r['activated'])
    return {
      city_name:            r['city_name'] as string,
      signed_up,
      docs_submitted:       num(r['docs_submitted']),
      activated,
      rejected_or_banned:   num(r['rejected_or_banned']),
      avg_hours_to_active:  r['avg_hours_to_active'] == null ? null : Number(r['avg_hours_to_active']),
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
    const total_active = num(r['total_active'])
    const available_now = num(r['available_now'])
    return {
      city_name:         r['city_name'] as string,
      total_active,
      online_now:        num(r['online_now']),
      available_now,
      availability_pct:  total_active > 0 ? (available_now / total_active) * 100 : 0,
    }
  })
}
