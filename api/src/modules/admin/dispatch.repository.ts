import { pool } from '@/db/client'
import { COUNT_CAP, capTotal } from './admin.repository'

// Dispatch desk: the rides that need a person to look at their driver situation, in two lanes.
//   scheduled     advance bookings still waiting for their dispatch time (rides_scheduled_idx, soonest first)
//   needs_driver  rides that should have a driver by now and do not: still searching after SEARCH_GRACE, or found none
//
// Every lane is a small, index-backed set (a status that is rare by nature), paged before any join, so the page costs the same
// at ten rides or ten million in the table. Nothing here walks `rides` by date.

export type DispatchLane = 'scheduled' | 'needs_driver'
export const SEARCH_GRACE_SECONDS = 90
/** A scheduled ride whose dispatch time passed this long ago and is still `scheduled` means the sweep missed it. */
export const OVERDUE_MINUTES = 5
// A ride that found no driver stays worth acting on for this long: the rider has usually gone, or booked elsewhere, after that.
export const NO_DRIVER_WINDOW_HOURS = 24

export interface DispatchFilters {
  lane: DispatchLane
  cityId?: number
  /** scheduled lane only: pickups within this many minutes */
  withinMinutes?: number
  limit: number
  offset: number
}

// When the ride was (or will be) handed to drivers: an advance booking at its dispatch buffer, anything else at booking time.
const DISPATCH_AT = `COALESCE(r.scheduled_for - (ram.dispatch_buffer_minutes * interval '1 minute'), r.requested_at)`

export async function getDispatchSummary() {
  const res = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM rides WHERE status = 'scheduled')::int AS scheduled_total,
       (SELECT COUNT(*) FROM rides WHERE status = 'scheduled' AND scheduled_for <= now() + interval '60 minutes')::int AS due_within_60m,
       (SELECT COUNT(*) FROM rides r JOIN ride_advance_meta ram ON ram.ride_id = r.id
         WHERE r.status = 'scheduled'
           AND r.scheduled_for - (ram.dispatch_buffer_minutes * interval '1 minute') < now() - interval '${OVERDUE_MINUTES} minutes')::int AS overdue,
       (SELECT COUNT(*) FROM rides r LEFT JOIN ride_advance_meta ram ON ram.ride_id = r.id
         WHERE r.status = 'requested' AND ${DISPATCH_AT} < now() - interval '${SEARCH_GRACE_SECONDS} seconds')::int AS searching_long,
       (SELECT COUNT(*) FROM rides WHERE status = 'no_drivers' AND requested_at >= now() - interval '${NO_DRIVER_WINDOW_HOURS} hours')::int AS no_drivers`,
  )
  return res.rows[0] as { scheduled_total: number; due_within_60m: number; overdue: number; searching_long: number; no_drivers: number }
}

export async function listDispatchQueue(f: DispatchFilters) {
  const params: unknown[] = []
  // The city filter is one parameter however many times it is written into the SQL.
  const city = (alias: string) => {
    if (f.cityId === undefined) return ''
    if (!params.includes(f.cityId)) params.push(f.cityId)
    return ` AND ${alias}.origin_city_id = $${params.indexOf(f.cityId) + 1}`
  }

  let candidates: string
  if (f.lane === 'scheduled') {
    let within = ''
    if (f.withinMinutes !== undefined) { params.push(f.withinMinutes); within = ` AND r.scheduled_for <= now() + make_interval(mins => $${params.length}::int)` }
    candidates = `SELECT r.id, r.scheduled_for AS sort_at FROM rides r WHERE r.status = 'scheduled'${city('r')}${within}`
  } else {
    // Longest-waiting first. `requested` is small by nature (rides being matched right now); `no_drivers` is covered by rides_no_drivers_idx.
    candidates = `SELECT r.id, ${DISPATCH_AT} AS sort_at FROM rides r LEFT JOIN ride_advance_meta ram ON ram.ride_id = r.id
       WHERE r.status = 'requested' AND ${DISPATCH_AT} < now() - interval '${SEARCH_GRACE_SECONDS} seconds'${city('r')}
       UNION ALL
       SELECT r.id, ${DISPATCH_AT} AS sort_at FROM rides r LEFT JOIN ride_advance_meta ram ON ram.ride_id = r.id
       WHERE r.status = 'no_drivers' AND r.requested_at >= now() - interval '${NO_DRIVER_WINDOW_HOURS} hours'${city('r')}`
  }

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM (SELECT 1 FROM (${candidates}) c LIMIT ${COUNT_CAP + 1}) t`,
    params,
  )
  const { total, totalCapped } = capTotal(countRes.rows[0].n as number)

  const p = params.length
  const dataRes = await pool.query(
    `SELECT
       r.id::text, r.status, r.ride_type, r.trip_mode, r.is_return_cab,
       r.origin_address, r.destination_address, r.requested_at, r.scheduled_for,
       ${DISPATCH_AT} AS dispatch_at, ram.status AS advance_status,
       u.name AS user_name, u.phone AS user_phone,
       vc.display_name AS category_name, oc.name AS city_name,
       COALESCE(fs.total_final, fs.total_estimated)::text AS fare,
       (SELECT COUNT(*)::int FROM ride_assignments a WHERE a.ride_id = r.id) AS offers_count
     FROM (
       SELECT id, sort_at FROM (${candidates}) c
       ORDER BY sort_at ASC, id ASC
       LIMIT $${p + 1} OFFSET $${p + 2}
     ) pg
     JOIN rides r ON r.id = pg.id
     JOIN users u ON u.id = r.user_id
     LEFT JOIN ride_advance_meta ram ON ram.ride_id = r.id
     LEFT JOIN vehicle_categories vc ON vc.id = r.category_id
     LEFT JOIN cities oc ON oc.id = r.origin_city_id
     LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
     ORDER BY pg.sort_at ASC, pg.id ASC`,
    [...params, f.limit, f.offset],
  )
  return { rows: dataRes.rows, total, totalCapped }
}
