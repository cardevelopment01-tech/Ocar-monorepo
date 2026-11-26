import { pool } from '@/db/client'
import { logger } from '@/lib/logger'
import { recordAuditLog } from '@/lib/audit-log'
import { fmtClock, fmtPickup } from '@/lib/ist-format'
import { advanceBookingEventsTotal } from '@/observability/metrics'
import { notifyOwner, notifyAllAdmins } from '@/modules/notifications/notifications.service'
import type { NotificationType } from '@/modules/notifications/notifications.registry'
import { socketEvents } from '@/websocket/socket.server'

const log = logger.child({ module: 'advance-reservations' })
const count = (event: string) => advanceBookingEventsTotal.inc({ event })
const httpErr = (status: number, message: string, code?: string) => Object.assign(new Error(message), { httpStatus: status, ...(code ? { code } : {}) })

// An admin can reserve a driver for an advance ride. The ride stays 'scheduled' and the driver stays free: they keep taking other rides, but only
// ones that they can finish, drive to the pickup of the reserved booking after, with a safety buffer. (Same idea as Bolt / Uber Reserve.)

/** Safety margin kept free before a reserved pickup, on top of the new ride's own duration and the drive to its pickup. */
export const RESERVATION_BUFFER_MIN = 20
/** A driver is asked to confirm the booking this long before it, and reminded again at the ready mark. */
export const RESERVATION_CONFIRM_BY_MIN = 60
export const RESERVATION_READY_MIN = 30
/** Handing a booking back inside this window is recorded as a late release (a warning for ops, not a penalty). */
export const RESERVATION_LATE_RELEASE_MIN = 60
/** Used only to turn "distance to the pickup" into minutes for the fit check; deliberately slow so the check errs on the safe side. */
export const RESERVATION_PICKUP_SPEED_KMH = 25
/** A ride with no estimate is assumed to take this long. */
const DEFAULT_RIDE_MIN = 60

export const travelMinutes = (distanceMetres: number): number =>
  !Number.isFinite(distanceMetres) || distanceMetres < 0 ? 30 : (distanceMetres / 1000 / RESERVATION_PICKUP_SPEED_KMH) * 60

/** How long a ride keeps its driver busy, in minutes: a booked window (round trip / rental hours) wins over the route estimate. */
export function rideDurationMin(r: { trip_hours?: number | string | null; estimated_min?: number | string | null }): number {
  const h = Number(r.trip_hours)
  if (Number.isFinite(h) && h > 0) return h * 60
  const m = Number(r.estimated_min)
  return Number.isFinite(m) && m > 0 ? m : DEFAULT_RIDE_MIN
}

/** True when a ride started now (drive to its pickup + the ride + the buffer) is over before a reserved pickup. */
export function fitsBeforeReservation(o: { nowMs: number; reservedAtMs: number; travelMin: number; durationMin: number }): boolean {
  return o.nowMs + (o.travelMin + o.durationMin + RESERVATION_BUFFER_MIN) * 60_000 <= o.reservedAtMs
}

// ── Who holds what ──────────────────────────────────────────────────────────

export interface ReservedSlot { rideId: string; at: Date }

/** The earliest reserved, not-yet-dispatched pickup of each driver (skipping one ride, so it never clashes with itself). */
export async function nextReservations(driverIds: bigint[], excludeRideId?: bigint): Promise<Map<string, ReservedSlot>> {
  const out = new Map<string, ReservedSlot>()
  if (driverIds.length === 0) return out
  const res = await pool.query<{ driver_id: string; ride_id: string; scheduled_for: Date }>(
    `SELECT DISTINCT ON (ram.claimed_by_driver_id) ram.claimed_by_driver_id::text AS driver_id, r.id::text AS ride_id, r.scheduled_for
       FROM ride_advance_meta ram JOIN rides r ON r.id = ram.ride_id
      WHERE ram.claimed_by_driver_id = ANY($1::bigint[]) AND r.status = 'scheduled' AND r.scheduled_for > now()
        AND ($2::bigint IS NULL OR r.id <> $2)
      ORDER BY ram.claimed_by_driver_id, r.scheduled_for`,
    [driverIds, excludeRideId ?? null],
  )
  for (const row of res.rows) out.set(row.driver_id, { rideId: row.ride_id, at: new Date(row.scheduled_for) })
  return out
}

/**
 * Drivers who can still be offered a ride of `durationMin` minutes. A driver with no reservation always can; one with a reservation only if the
 * ride fits before it (see fitsBeforeReservation). Fails open: if the lookup breaks, nobody is dropped (an offer is worth more than a perfect check).
 */
export async function dropReservationClashes<T extends { driver_id: bigint; distance_metres: number }>(
  drivers: T[], durationMin: number, excludeRideId?: bigint, nowMs = Date.now(),
): Promise<T[]> {
  if (drivers.length === 0) return drivers
  let next: Map<string, ReservedSlot>
  try { next = await nextReservations(drivers.map((d) => d.driver_id), excludeRideId) }
  catch (err) { log.error({ err }, 'reservation lookup failed, not filtering offers'); return drivers }
  if (next.size === 0) return drivers
  return drivers.filter((d) => {
    const slot = next.get(d.driver_id.toString())
    return !slot || fitsBeforeReservation({ nowMs, reservedAtMs: slot.at.getTime(), travelMin: travelMinutes(d.distance_metres), durationMin })
  })
}

/** For a single driver acting on a ride (accept tap, admin assignment): the reservation this ride would run into, or null. */
export async function reservationClash(driverId: bigint, rideId: bigint, nowMs = Date.now()): Promise<ReservedSlot | null> {
  const res = await pool.query<{ scheduled_for: Date | null; trip_hours: string | null; estimated_min: string | null; dist: string | null }>(
    `SELECT r.scheduled_for, fs.trip_hours, fs.estimated_min,
            ST_Distance(r.origin, s.location)::text AS dist
       FROM rides r
       LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
       LEFT JOIN driver_location_snapshots s ON s.driver_id = $1
      WHERE r.id = $2`,
    [driverId, rideId],
  ).catch(() => null)
  const row = res?.rows[0]
  if (!row) return null
  // A booking being dispatched is judged on its own pickup time, not "starting now".
  const startMs = row.scheduled_for ? Math.max(nowMs, new Date(row.scheduled_for).getTime()) : nowMs
  const slot = (await nextReservations([driverId], rideId)).get(driverId.toString())
  if (!slot) return null
  const fits = fitsBeforeReservation({
    nowMs: startMs, reservedAtMs: slot.at.getTime(),
    travelMin: row.scheduled_for ? 0 : travelMinutes(Number(row.dist)),
    durationMin: rideDurationMin(row),
  })
  return fits ? null : slot
}

// ── Messages (short, plain; times in IST) ───────────────────────────────────

type ReservationNotice = Extract<NotificationType, 'advance_reserved' | 'advance_reserve_reminder' | 'advance_reserve_released' | 'advance_reserve_alert'>

async function tellDriver(type: ReservationNotice, driverId: bigint, rideId: bigint, title: string, body: string): Promise<void> {
  try { await notifyOwner({ ownerType: 'driver', ownerId: driverId, type, title, body, rideId, payload: { rideId: rideId.toString(), screen: 'reservations' } }) }
  catch (err) { log.error({ err, type, rideId: rideId.toString() }, 'driver reservation notice failed') }
}
async function tellOps(rideId: bigint, title: string, body: string): Promise<void> {
  await notifyAllAdmins({ type: 'advance_reserve_alert', title, body, rideId }).catch(() => undefined)
}

export const reservationMessages = {
  reserved: (pickup: Date) => ({ title: 'New booking for you', body: `Booking for ${fmtPickup(pickup)} was assigned to you. Open Upcoming bookings to confirm. You can keep taking rides until then; we only send ones that finish in time.` }),
  confirmAsk: (pickup: Date) => ({ title: 'Please confirm your booking', body: `Your booking at ${fmtClock(pickup)} is in about an hour. Tap to confirm you will be there.` }),
  confirmedSoon: (pickup: Date) => ({ title: 'Booking in about an hour', body: `Your booking is at ${fmtClock(pickup)}. We only send rides that finish before it.` }),
  ready: (pickup: Date) => ({ title: 'Get ready for your booking', body: `Booking at ${fmtClock(pickup)} is in about 30 minutes. Be online and near the pickup.` }),
  released: (pickup: Date) => ({ title: 'Booking taken off you', body: `The ${fmtPickup(pickup)} booking was given to another driver.` }),
}

// ── Admin reserves / releases ───────────────────────────────────────────────

/** Other bookings of this driver (reserved, or already accepted advance rides) whose time window would collide with this one. */
async function overlappingBooking(driverId: bigint, rideId: bigint, at: Date, durationMin: number): Promise<{ rideId: string; at: Date } | null> {
  const res = await pool.query<{ ride_id: string; scheduled_for: Date; trip_hours: string | null; estimated_min: string | null }>(
    `SELECT r.id::text AS ride_id, r.scheduled_for, fs.trip_hours, fs.estimated_min
       FROM rides r
       LEFT JOIN ride_advance_meta ram ON ram.ride_id = r.id
       LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
      WHERE r.id <> $2 AND r.scheduled_for IS NOT NULL
        AND ((r.status = 'scheduled' AND ram.claimed_by_driver_id = $1) OR (r.driver_id = $1 AND r.status IN ('accepted', 'driver_arrived')))`,
    [driverId, rideId],
  )
  const bufferMs = RESERVATION_BUFFER_MIN * 60_000
  const aEnd = at.getTime() + durationMin * 60_000 + bufferMs
  for (const o of res.rows) {
    const oStart = new Date(o.scheduled_for).getTime()
    const oEnd = oStart + rideDurationMin(o) * 60_000 + bufferMs
    if (at.getTime() < oEnd && oStart < aEnd) return { rideId: o.ride_id, at: new Date(o.scheduled_for) }
  }
  return null
}

export async function reserveDriver(rideId: bigint, driverId: bigint, adminId: bigint, ip: string | null = null, override = false): Promise<{ success: true; replaced: boolean }> {
  const res = await pool.query<{ status: string; scheduled_for: Date | null; origin_city_id: string | null; trip_hours: string | null; estimated_min: string | null; prev: string | null; meta: string | null }>(
    `SELECT r.status, r.scheduled_for, r.origin_city_id::text, fs.trip_hours, fs.estimated_min, ram.claimed_by_driver_id::text AS prev, ram.id::text AS meta
       FROM rides r LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id LEFT JOIN ride_advance_meta ram ON ram.ride_id = r.id
      WHERE r.id = $1`, [rideId])
  const ride = res.rows[0]
  if (!ride) throw httpErr(404, 'Ride not found')
  if (ride.status !== 'scheduled' || !ride.scheduled_for || !ride.meta) throw httpErr(409, 'Only a booked advance ride can have a driver reserved', 'NOT_RESERVABLE')
  const at = new Date(ride.scheduled_for)
  if (at.getTime() <= Date.now()) throw httpErr(409, 'This booking is already due: assign a driver directly', 'NOT_RESERVABLE')

  const d = await pool.query<{ status: string; city_id: string | null }>(`SELECT status, city_id::text FROM drivers WHERE id = $1`, [driverId])
  if (!d.rows[0]) throw httpErr(404, 'Driver not found')
  if (d.rows[0].status !== 'active') throw httpErr(422, 'Driver is not active', 'DRIVER_NOT_ACTIVE')
  if (ride.origin_city_id && d.rows[0].city_id !== ride.origin_city_id && !override) throw httpErr(422, 'Driver works in another city', 'DRIVER_OTHER_CITY')

  const clash = await overlappingBooking(driverId, rideId, at, rideDurationMin(ride))
  if (clash && !override) {
    throw httpErr(409, `Driver already has a booking at ${fmtPickup(clash.at)} (ride #${clash.rideId}) that overlaps this one`, 'RESERVATION_OVERLAP')
  }

  const replaced = ride.prev !== null && ride.prev !== driverId.toString()
  const upd = await pool.query(
    `UPDATE ride_advance_meta SET claimed_by_driver_id = $2, claimed_by_admin_id = $3, claimed_at = now(), reservation_confirmed_at = NULL,
            reservation_remind_60_at = NULL, reservation_remind_30_at = NULL, reservation_risk_alerted_at = NULL
      WHERE ride_id = $1 AND EXISTS (SELECT 1 FROM rides WHERE id = $1 AND status = 'scheduled')`,
    [rideId, driverId, adminId],
  )
  if ((upd.rowCount ?? 0) === 0) throw httpErr(409, 'Ride status changed, please refresh')
  await pool.query(
    `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor, actor_id, note) VALUES ($1, 'scheduled', 'scheduled', 'admin', $2, $3)`,
    [rideId, adminId, `Reserved for driver ${driverId}${replaced ? ` (was driver ${ride.prev})` : ''}`],
  )
  count('driver_reserved')
  await recordAuditLog({
    adminId, action: 'ride.reserve_driver', targetTable: 'rides', targetId: rideId,
    beforeState: { claimed_by_driver_id: ride.prev }, afterState: { claimed_by_driver_id: driverId.toString() }, ipAddress: ip,
  }).catch(() => undefined)

  if (replaced && ride.prev) {
    const m = reservationMessages.released(at)
    await tellDriver('advance_reserve_released', BigInt(ride.prev), rideId, m.title, m.body)
  }
  const m = reservationMessages.reserved(at)
  await tellDriver('advance_reserved', driverId, rideId, m.title, m.body)
  socketEvents.sendRideRequest(driverId.toString(), { reservation: true }) // nudges an open app to refresh the upcoming list
  return { success: true, replaced }
}

export type ReleaseBy = 'admin' | 'driver' | 'system'

/**
 * Takes the reservation off a ride. When the driver gives it back inside the last hour it is recorded as a late release, and ops are told.
 * `event` overrides what is recorded (a driver who could not be ready is 'dropped_busy').
 */
export async function releaseReservation(
  rideId: bigint, by: ReleaseBy,
  opts: { actorId?: bigint; reason?: string; event?: 'declined' | 'dropped_busy' | 'no_confirm'; expectDriverId?: bigint; notifyDriver?: boolean } = {},
): Promise<{ released: boolean; driverId?: string }> {
  const upd = await pool.query<{ driver_id: string; scheduled_for: Date }>(
    `WITH prev AS (
       SELECT ram.id, ram.claimed_by_driver_id AS driver_id, r.scheduled_for
         FROM ride_advance_meta ram JOIN rides r ON r.id = ram.ride_id
        WHERE ram.ride_id = $1 AND ram.claimed_by_driver_id IS NOT NULL AND r.status IN ('scheduled', 'requested')
          AND ($2::bigint IS NULL OR ram.claimed_by_driver_id = $2)
          FOR UPDATE OF ram)
     UPDATE ride_advance_meta ram SET claimed_by_driver_id = NULL, claimed_by_admin_id = NULL, claimed_at = NULL, reservation_confirmed_at = NULL,
            reservation_remind_60_at = NULL, reservation_remind_30_at = NULL, reservation_risk_alerted_at = NULL
       FROM prev WHERE ram.id = prev.id
     RETURNING prev.driver_id::text AS driver_id, prev.scheduled_for`,
    [rideId, opts.expectDriverId ?? null],
  )
  const row = upd.rows[0]
  if (!row) return { released: false }
  const driverId = BigInt(row.driver_id)
  const at = new Date(row.scheduled_for)
  const minutesBefore = Math.round((at.getTime() - Date.now()) / 60_000)
  const late = by === 'driver' && minutesBefore < RESERVATION_LATE_RELEASE_MIN
  const event = opts.event ?? (late ? 'released_late' : by === 'driver' ? 'declined' : null)
  if (event) {
    await pool.query(`INSERT INTO driver_reservation_events (driver_id, ride_id, event, minutes_before) VALUES ($1, $2, $3, $4)`, [driverId, rideId, event, minutesBefore])
      .catch((err: unknown) => log.error({ err }, 'reservation event not recorded'))
  }
  await pool.query(
    `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor, actor_id, note) VALUES ($1, 'scheduled', 'scheduled', $2, $3, $4)`,
    [rideId, by, opts.actorId ?? (by === 'driver' ? driverId : null), `Reservation of driver ${driverId} released${opts.reason ? `: ${opts.reason}` : ''}`],
  ).catch(() => undefined)
  count(`reservation_released_${by}`)

  if (by !== 'driver' && opts.notifyDriver !== false) {
    const m = reservationMessages.released(at)
    await tellDriver('advance_reserve_released', driverId, rideId, m.title, m.body)
  }
  if (by === 'driver') {
    await tellOps(rideId, late ? 'Driver gave back a booking (late)' : 'Driver declined a booking',
      `Ride #${rideId} (pickup ${fmtPickup(at)}): driver ${driverId} gave the booking back${late ? ` ${minutesBefore} min before the pickup` : ''}. Reserve another driver.`)
  }
  return { released: true, driverId: driverId.toString() }
}

// ── The driver's side ───────────────────────────────────────────────────────

export interface DriverReservation {
  rideId: string; pickupAt: string; pickup: string | null; drop: string | null; rideType: string; isReturnCab: boolean
  estimatedFare: number | null; confirmed: boolean; confirmBy: string; readyBy: string; canConfirm: boolean; handBackIsLate: boolean
}

export async function listDriverReservations(driverId: bigint): Promise<DriverReservation[]> {
  const res = await pool.query<{ ride_id: string; scheduled_for: Date; origin_address: string | null; destination_address: string | null; ride_type: string; is_return_cab: boolean; fare: string | null; confirmed_at: Date | null }>(
    `SELECT r.id::text AS ride_id, r.scheduled_for, r.origin_address, r.destination_address, r.ride_type, r.is_return_cab,
            fs.total_estimated::text AS fare, ram.reservation_confirmed_at AS confirmed_at
       FROM ride_advance_meta ram JOIN rides r ON r.id = ram.ride_id LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
      WHERE ram.claimed_by_driver_id = $1 AND r.status = 'scheduled' AND r.scheduled_for > now() - interval '1 hour'
      ORDER BY r.scheduled_for LIMIT 20`, [driverId])
  const now = Date.now()
  return res.rows.map((r) => {
    const at = new Date(r.scheduled_for)
    return {
      rideId: r.ride_id, pickupAt: at.toISOString(), pickup: r.origin_address, drop: r.destination_address, rideType: r.ride_type, isReturnCab: r.is_return_cab,
      estimatedFare: r.fare == null ? null : Math.round(Number(r.fare)), confirmed: r.confirmed_at != null,
      confirmBy: new Date(at.getTime() - RESERVATION_CONFIRM_BY_MIN * 60_000).toISOString(),
      readyBy: new Date(at.getTime() - RESERVATION_READY_MIN * 60_000).toISOString(),
      canConfirm: r.confirmed_at == null, handBackIsLate: at.getTime() - now < RESERVATION_LATE_RELEASE_MIN * 60_000,
    }
  })
}

export async function confirmReservation(driverId: bigint, rideId: bigint): Promise<{ confirmed: true }> {
  const upd = await pool.query(
    `UPDATE ride_advance_meta ram SET reservation_confirmed_at = COALESCE(reservation_confirmed_at, now()), status = 'driver_confirmed'
       FROM rides r WHERE r.id = ram.ride_id AND ram.ride_id = $1 AND ram.claimed_by_driver_id = $2 AND r.status = 'scheduled'`,
    [rideId, driverId])
  if ((upd.rowCount ?? 0) === 0) throw httpErr(409, 'This booking is no longer yours', 'RESERVATION_GONE')
  count('reservation_confirmed')
  return { confirmed: true }
}

export async function declineReservation(driverId: bigint, rideId: bigint): Promise<{ released: true; late: boolean }> {
  const at = await pool.query<{ scheduled_for: Date }>(`SELECT scheduled_for FROM rides WHERE id = $1`, [rideId])
  const mins = at.rows[0]?.scheduled_for ? (new Date(at.rows[0].scheduled_for).getTime() - Date.now()) / 60_000 : Infinity
  const r = await releaseReservation(rideId, 'driver', { expectDriverId: driverId, reason: 'driver declined' })
  if (!r.released) throw httpErr(409, 'This booking is no longer yours', 'RESERVATION_GONE')
  return { released: true, late: mins < RESERVATION_LATE_RELEASE_MIN }
}

/** How many times a driver gave a booking back late recently: shown to ops as a warning count. */
export async function lateReleaseCounts(driverIds: bigint[], days = 30): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (driverIds.length === 0) return out
  const res = await pool.query<{ driver_id: string; n: string }>(
    `SELECT driver_id::text, count(*)::text AS n FROM driver_reservation_events
      WHERE driver_id = ANY($1::bigint[]) AND event IN ('released_late', 'dropped_busy', 'no_confirm') AND created_at > now() - make_interval(days => $2)
      GROUP BY driver_id`, [driverIds, days])
  for (const r of res.rows) out.set(r.driver_id, Number(r.n))
  return out
}

// ── Dispatch: hand the booking to the reserved driver ───────────────────────

/**
 * Called when a booking enters its dispatch window (the ride is already 'requested'). If a driver is reserved and can take it, the booking goes straight to
 * them. If they are offline or still on another ride, the reservation is released (recorded, ops told) and the caller carries on with the normal search.
 * Returns true when the driver accepted and no search is needed.
 */
export async function dispatchToReservedDriver(
  rideId: bigint,
  accept: (driverId: bigint, rideId: bigint) => Promise<unknown>,
  createOffer: (a: { rideId: bigint; driverId: bigint; sessionId: bigint; expiresAt: Date; broadcastRound: number }) => Promise<unknown>,
): Promise<boolean> {
  const m = await pool.query<{ driver_id: string | null; scheduled_for: Date }>(
    `SELECT ram.claimed_by_driver_id::text AS driver_id, r.scheduled_for FROM ride_advance_meta ram JOIN rides r ON r.id = ram.ride_id WHERE ram.ride_id = $1`, [rideId])
  const driverIdText = m.rows[0]?.driver_id
  if (!driverIdText) return false
  const driverId = BigInt(driverIdText)
  const at = new Date(m.rows[0]!.scheduled_for)

  const st = await pool.query<{ session_id: string | null; session_status: string | null; live: string | null }>(
    `SELECT s.id::text AS session_id, s.status AS session_status,
            (SELECT id::text FROM rides WHERE driver_id = $1 AND status IN ('accepted', 'driver_arrived', 'in_progress', 'returning') LIMIT 1) AS live
       FROM drivers d LEFT JOIN driver_sessions s ON s.driver_id = d.id AND s.status IN ('online', 'on_trip') WHERE d.id = $1 ORDER BY s.id DESC LIMIT 1`, [driverId])
  const s = st.rows[0]
  const unavailable = !s?.session_id ? 'offline' : s.live ? `still on ride #${s.live}` : s.session_status !== 'online' ? 'busy' : null
  if (unavailable) {
    await releaseReservation(rideId, 'system', { event: unavailable === 'offline' ? 'no_confirm' : 'dropped_busy', reason: `driver ${unavailable} at dispatch`, notifyDriver: false })
    const dm = reservationMessages.released(at)
    await tellDriver('advance_reserve_released', driverId, rideId, dm.title, `${dm.body} You were ${unavailable} when it was due, so we looked for someone else.`)
    await tellOps(rideId, 'Reserved driver was not available', `Ride #${rideId} (pickup ${fmtPickup(at)}): reserved driver ${driverId} was ${unavailable} at dispatch time. Searching for another driver.`)
    return false
  }
  try {
    await createOffer({ rideId, driverId, sessionId: BigInt(s!.session_id!), expiresAt: new Date(Date.now() + 60_000), broadcastRound: 0 })
    await accept(driverId, rideId)
    count('reserved_dispatch_accepted')
    return true
  } catch (err) {
    log.error({ err, rideId: rideId.toString() }, 'could not hand the booking to its reserved driver, searching instead')
    await tellOps(rideId, 'Reserved driver could not be assigned', `Ride #${rideId}: handing it to reserved driver ${driverId} failed. Searching for another driver.`)
    return false
  }
}

// ── Reminders (60 s sweep) ──────────────────────────────────────────────────

/**
 * 60 min before: ask the driver to confirm (or just remind them if already confirmed). 30 min before: "be ready". At the 30 minute mark ops are also
 * told once if the booking is at risk: not confirmed, driver offline, or still on a ride. Each step is claimed with UPDATE ... IS NULL, so
 * two sweeps never send it twice.
 */
export async function sendReservationReminders(): Promise<{ confirmAsks: number; ready: number; atRisk: number }> {
  const out = { confirmAsks: 0, ready: 0, atRisk: 0 }
  for (const step of [
    { col: 'reservation_remind_60_at', from: `now() + interval '35 minutes'`, to: `now() + interval '${RESERVATION_CONFIRM_BY_MIN + 5} minutes'`, kind: 'ask' as const },
    { col: 'reservation_remind_30_at', from: `now() + interval '5 minutes'`, to: `now() + interval '${RESERVATION_READY_MIN + 5} minutes'`, kind: 'ready' as const },
  ]) {
    const claimed = await pool.query<{ ride_id: string; driver_id: string; scheduled_for: Date; confirmed: boolean }>(
      `UPDATE ride_advance_meta ram SET ${step.col} = now() FROM rides r
        WHERE r.id = ram.ride_id AND r.status = 'scheduled' AND ram.claimed_by_driver_id IS NOT NULL AND ram.${step.col} IS NULL
          AND r.scheduled_for > ${step.from} AND r.scheduled_for <= ${step.to}
        RETURNING ram.ride_id::text AS ride_id, ram.claimed_by_driver_id::text AS driver_id, r.scheduled_for, (ram.reservation_confirmed_at IS NOT NULL) AS confirmed`)
    for (const row of claimed.rows) {
      const at = new Date(row.scheduled_for)
      const rideId = BigInt(row.ride_id); const driverId = BigInt(row.driver_id)
      const msg = step.kind === 'ready' ? reservationMessages.ready(at) : row.confirmed ? reservationMessages.confirmedSoon(at) : reservationMessages.confirmAsk(at)
      await tellDriver('advance_reserve_reminder', driverId, rideId, msg.title, msg.body)
      if (step.kind === 'ask') out.confirmAsks++; else out.ready++

      if (step.kind === 'ready') {
        const risk = await pool.query<{ online: boolean; live: string | null }>(
          `SELECT EXISTS (SELECT 1 FROM driver_sessions WHERE driver_id = $1 AND status IN ('online', 'on_trip')) AS online,
                  (SELECT id::text FROM rides WHERE driver_id = $1 AND status IN ('accepted', 'driver_arrived', 'in_progress', 'returning') LIMIT 1) AS live`, [driverId])
        const why = !row.confirmed ? 'has not confirmed' : !risk.rows[0]?.online ? 'is offline' : risk.rows[0]?.live ? `is still on ride #${risk.rows[0].live}` : null
        if (why) {
          await pool.query(`UPDATE ride_advance_meta SET reservation_risk_alerted_at = now() WHERE ride_id = $1`, [rideId])
          await tellOps(rideId, 'Reserved booking at risk', `Ride #${rideId} (pickup ${fmtPickup(at)}): reserved driver ${driverId} ${why}. Reserve someone else if this is not sorted soon.`)
          out.atRisk++
        }
      }
    }
  }
  return out
}
