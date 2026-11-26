import { pool } from '@/db/client'
import { logger } from '@/lib/logger'
import { queues, QUEUE_NAMES } from '@/jobs/queues'
import { recordAuditLog } from '@/lib/audit-log'
import { getAdvancePolicy } from '@/lib/advance-policy'
import { fmtClock, fmtPickup } from '@/lib/ist-format'
import { advanceBookingEventsTotal } from '@/observability/metrics'
import { releaseForRide } from '@/modules/offers/settlement'
import { notifyOwner, notifyAllAdmins } from '@/modules/notifications/notifications.service'
import type { NotificationType } from '@/modules/notifications/notifications.registry'
import { socketEvents } from '@/websocket/socket.server'
import { MIN_ADVANCE_BOOKING_MINUTES, MAX_ADVANCE_BOOKING_DAYS } from '@/constants/limits'
import { expireRideRequests } from '@/modules/rides/request-expiry'
import type { BroadcastJobData } from '@/jobs/processors/broadcast.processor'
import * as repo from './rides.repository'
import { releaseReservation } from './reservation.service'

const log = logger.child({ module: 'advance-bookings' })

/** Pause between one full set of broadcast rounds and the next while a ride is still being searched for. */
export const ADVANCE_RETRY_GAP_SECONDS = 90

const count = (event: string) => advanceBookingEventsTotal.inc({ event })
const httpErr = (status: number, message: string, code?: string) => Object.assign(new Error(message), { httpStatus: status, ...(code ? { code } : {}) })

// ── Messages to the rider ───────────────────────────────────────────────────
// Plain and short: what happened, the time, what they can do. Times are IST. Built in code (not templates) so a missing template row cannot lose them.

type AdvanceNotice = Extract<NotificationType, 'advance_booked' | 'advance_reminder' | 'advance_rescheduled' | 'advance_searching' | 'advance_no_drivers' | 'advance_cancelled' | 'advance_driver_cancelled'>

async function tell(type: AdvanceNotice, userId: bigint, rideId: bigint, title: string, body: string): Promise<void> {
  try {
    await notifyOwner({ ownerType: 'user', ownerId: userId, type, title, body, rideId, payload: { rideId: rideId.toString() } })
  } catch (err) {
    log.error({ err, type, rideId: rideId.toString() }, 'advance booking notice failed')
  }
}

const searchStartsAt = (pickup: Date, bufferMin: number) => new Date(pickup.getTime() - bufferMin * 60_000)

export const advanceMessages = {
  booked: (pickup: Date, bufferMin: number) => ({
    title: 'Ride booked',
    body: `Pickup ${fmtPickup(pickup)}. We start finding your driver at ${fmtClock(searchStartsAt(pickup, bufferMin))}. You can change the time or cancel in the app.`,
  }),
  reminder: (pickup: Date, bufferMin: number, hoursAhead: 24 | 1) => ({
    title: hoursAhead === 24 ? 'Your ride is tomorrow' : 'Your ride is coming up',
    body: `Pickup ${fmtPickup(pickup)}. We start finding your driver at ${fmtClock(searchStartsAt(pickup, bufferMin))}. Need to change the time? You can do it in the app.`,
  }),
  rescheduled: (pickup: Date, bufferMin: number) => ({
    title: 'Pickup time changed',
    body: `Your pickup is now ${fmtPickup(pickup)}. We start finding your driver at ${fmtClock(searchStartsAt(pickup, bufferMin))}.`,
  }),
  searching: (pickup: Date) => ({
    title: 'Still finding your driver',
    body: `We are still looking for a driver for your ${fmtClock(pickup)} pickup and will keep trying. You can change the time or cancel any time.`,
  }),
  driverCancelled: (pickup: Date) => ({
    title: 'Finding you another driver',
    body: `Your driver can no longer take your ${fmtPickup(pickup)} ride. We are finding you another one right now. Your booking and fare are unchanged, and you do not need to do anything.`,
  }),
  noDrivers: (pickup: Date) => ({
    title: 'No driver found',
    body: `We could not find a driver for your ${fmtPickup(pickup)} pickup, and you have not been charged. Sorry about that. You can book again or pick a new time.`,
  }),
  cancelledByAdmin: (pickup: Date, reason: string) => ({
    title: 'Ride cancelled by Ocar support',
    body: `Your ${fmtPickup(pickup)} ride was cancelled: ${reason}. You have not been charged.`,
  }),
}

export async function tellBooked(userId: bigint, rideId: bigint, pickup: Date, bufferMin: number): Promise<void> {
  const m = advanceMessages.booked(pickup, bufferMin)
  count('booked')
  await tell('advance_booked', userId, rideId, m.title, m.body)
}

export async function tellNoDrivers(userId: bigint, rideId: bigint, pickup: Date): Promise<void> {
  count('no_drivers')
  const m = advanceMessages.noDrivers(pickup)
  await tell('advance_no_drivers', userId, rideId, m.title, m.body)
}

// ── Changing the time ───────────────────────────────────────────────────────

export type RescheduleActor =
  | { type: 'user'; userId: bigint }
  | { type: 'admin'; adminId: bigint; reason: string; ip: string | null }

/** Moves the dispatch job to the new time. The database `scheduled_for` stays the source of truth: the 60 s sweep dispatches from it even if this fails. */
async function repointDispatchJob(rideId: bigint, pickup: Date, bufferMin: number, jobId: string | null): Promise<void> {
  const delay = Math.max(pickup.getTime() - bufferMin * 60_000 - Date.now(), 0)
  const q = queues[QUEUE_NAMES.SCHEDULER]
  try {
    const job = jobId ? await q.getJob(jobId) : undefined
    if (job && (await job.isDelayed())) { await job.changeDelay(delay); return }
    if (job) await job.remove().catch(() => undefined)
    const fresh = await q.add('dispatch_scheduled_ride', { rideId: rideId.toString() }, { delay, attempts: 3, removeOnComplete: true })
    if (fresh.id) await repo.setAdvanceMetaJobId(rideId, fresh.id)
  } catch (err) {
    log.warn({ err, rideId: rideId.toString() }, 'could not move the dispatch job; the sweep will dispatch from scheduled_for')
  }
}

/** The booking rules for any pickup time (rider or admin): at least MIN ahead, at most MAX days. */
export function checkPickupWindow(when: Date, now = Date.now()): void {
  if (Number.isNaN(when.getTime())) throw httpErr(422, 'Invalid pickup time')
  if (when.getTime() < now + MIN_ADVANCE_BOOKING_MINUTES * 60_000) throw httpErr(422, `Pickup must be at least ${MIN_ADVANCE_BOOKING_MINUTES} minutes from now`)
  if (when.getTime() > now + MAX_ADVANCE_BOOKING_DAYS * 86_400_000) throw httpErr(422, `Pickup can be at most ${MAX_ADVANCE_BOOKING_DAYS} days ahead`)
}

export async function rescheduleAdvanceRide(rideId: bigint, scheduledFor: string, actor: RescheduleActor): Promise<{ scheduledFor: string; reschedulesLeft: number | null }> {
  const when = new Date(scheduledFor)
  checkPickupWindow(when)

  const ride = await repo.getRideCoreById(rideId)
  if (!ride) throw httpErr(404, 'Ride not found')
  if (actor.type === 'user' && BigInt(ride.user_id) !== actor.userId) throw httpErr(403, 'Forbidden')
  if (ride.status !== 'scheduled' || !ride.scheduled_for) {
    throw httpErr(409, 'The time can only be changed before we start looking for a driver', 'NOT_RESCHEDULABLE')
  }
  const meta = await repo.getAdvanceMeta(rideId)
  if (!meta) throw httpErr(409, 'This ride has no advance booking to change', 'NOT_RESCHEDULABLE')
  const policy = await getAdvancePolicy()
  if (actor.type === 'user' && meta.reschedule_count >= policy.rescheduleMax) {
    throw httpErr(409, `You can change the time ${policy.rescheduleMax} time${policy.rescheduleMax === 1 ? '' : 's'}. Cancel and book again if you need another time.`, 'RESCHEDULE_LIMIT')
  }

  const before = new Date(ride.scheduled_for)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const upd = await client.query(`UPDATE rides SET scheduled_for = $2, updated_at = now() WHERE id = $1 AND status = 'scheduled'`, [rideId, when])
    if ((upd.rowCount ?? 0) === 0) throw httpErr(409, 'The ride changed while you were editing it. Refresh and try again.', 'NOT_RESCHEDULABLE')
    await client.query(
      `UPDATE ride_advance_meta
          SET reschedule_count = reschedule_count + $2, reminder_24h_sent_at = NULL, reminder_1h_sent_at = NULL,
              search_until = NULL, search_alerted_at = NULL
        WHERE ride_id = $1`,
      [rideId, actor.type === 'user' ? 1 : 0],
    )
    await client.query(
      `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor, actor_id, note) VALUES ($1, 'scheduled', 'scheduled', $2, $3, $4)`,
      [rideId, actor.type, actor.type === 'user' ? actor.userId : actor.adminId,
        `Pickup moved from ${fmtPickup(before)} to ${fmtPickup(when)}${actor.type === 'admin' ? `: ${actor.reason}` : ''}`],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }

  await repointDispatchJob(rideId, when, meta.dispatch_buffer_minutes, meta.dispatch_job_id)
  count('rescheduled')
  const m = advanceMessages.rescheduled(when, meta.dispatch_buffer_minutes)
  await tell('advance_rescheduled', BigInt(ride.user_id), rideId, m.title, m.body)
  if (actor.type === 'admin') {
    await recordAuditLog({
      adminId: actor.adminId, action: 'ride.reschedule', targetTable: 'rides', targetId: rideId,
      beforeState: { scheduled_for: before.toISOString() }, afterState: { scheduled_for: when.toISOString() }, ipAddress: actor.ip, reason: actor.reason,
    })
  }
  return { scheduledFor: when.toISOString(), reschedulesLeft: actor.type === 'user' ? Math.max(policy.rescheduleMax - (meta.reschedule_count + 1), 0) : null }
}

// ── A driver drops out of an accepted advance ride ──────────────────────────

/** Ride columns this needs; getRideCoreById returns all of them. */
export interface RedispatchRide {
  id: string | number | bigint; user_id: string | number | bigint; status: string; scheduled_for: string | Date | null
  category_id: string | number | bigint; origin_lat: number; origin_lng: number; ride_type: string; is_return_cab: boolean
  dest_lat?: number | null; dest_lng?: number | null; trip_hours?: string | number | null
}

/**
 * The rider booked a pickup TIME, not a one-off request: when the driver who took the ride drops out before the trip starts, the booking is
 * still good, so the ride goes back to being searched for (fresh rounds, the same fare and offer, the cancelling driver left out) instead of
 * being cancelled with the rider told to start again. Used while the pickup is still ahead, or within the admin's search grace after it.
 *
 * Returns true when the ride was put back to searching. False when it does not apply (not an advance ride, no driver on it yet, or the pickup
 * time is already too far gone to be worth searching for), so the caller cancels exactly as it always did.
 */
export async function redispatchAfterDriverCancel(ride: RedispatchRide, driverId: bigint, reasonCode?: string, reason?: string): Promise<boolean> {
  if (!ride.scheduled_for || (ride.status !== 'accepted' && ride.status !== 'driver_arrived')) return false
  const pickup = new Date(ride.scheduled_for)
  const policy = await getAdvancePolicy()
  if (Date.now() >= pickup.getTime() + policy.searchGraceMin * 60_000) return false

  const rideId = BigInt(ride.id)
  const note = `Driver ${driverId} cancelled${reasonCode ? ` (${reasonCode})` : ''}${reason ? `: ${reason}` : ''}. Looking for another driver.`
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Same shape as the force-assign revert: no driver on the ride, back to requested. The fare, the offer reservation and the booking stay.
    const upd = await client.query(
      `UPDATE rides SET status = 'requested', driver_id = NULL, accepted_at = NULL, driver_arrived_at = NULL,
              force_assign_grace_job_id = NULL, updated_at = now()
        WHERE id = $1 AND driver_id = $2 AND status = $3 RETURNING id`,
      [rideId, driverId, ride.status],
    )
    if ((upd.rowCount ?? 0) === 0) throw httpErr(409, 'Ride status changed — please refresh')
    await client.query(`UPDATE ride_assignments SET status = 'cancelled', cancelled_at = now() WHERE ride_id = $1 AND driver_id = $2 AND status = 'accepted'`, [rideId, driverId])
    await client.query(`UPDATE driver_sessions SET status = 'online' WHERE driver_id = $1 AND status = 'on_trip'`, [driverId])
    await client.query(`UPDATE driver_location_snapshots SET is_available = true WHERE driver_id = $1`, [driverId])
    await client.query(`UPDATE ride_advance_meta SET status = 'dispatched', search_until = NULL, search_alerted_at = NULL WHERE ride_id = $1`, [rideId])
    // This history row is also how the next rounds know to leave this driver out (repo.getDriversWhoLeftRide), and the audit trail of it.
    await client.query(
      `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor, actor_id, note) VALUES ($1, $2, 'requested', 'driver', $3, $4)`,
      [rideId, ride.status, driverId, note],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }

  count('driver_cancel_redispatch')
  // If this driver was the one reserved for the booking, the reservation ends with their cancel and it counts as a hand-back (ops are told just below).
  await releaseReservation(rideId, 'driver', { expectDriverId: driverId, reason: 'driver cancelled after the booking started', notifyOps: false }).catch((err: unknown) => log.error({ err, rideId: rideId.toString() }, 'reservation release after driver cancel failed'))
  socketEvents.sendRideStatusUpdate(rideId.toString(), { status: 'requested', reason: 'driver_cancelled_redispatch' })
  const m = advanceMessages.driverCancelled(pickup)
  await tell('advance_driver_cancelled', BigInt(ride.user_id), rideId, m.title, m.body)
  await notifyAllAdmins({
    type: 'advance_driver_cancelled', title: 'Driver dropped an advance ride',
    body: `Ride #${rideId} (pickup ${fmtPickup(pickup)}): driver ${driverId} cancelled${reasonCode ? ` (${reasonCode})` : ''}. Searching for another driver; assign one from the Dispatch desk if it takes long.`, rideId,
  }).catch(() => undefined)

  // Fresh rounds, the way the first dispatch ran them. Job ids carry how many drivers have dropped out, so they never clash with the earlier rounds.
  const dropped = (await repo.getDriversWhoLeftRide(rideId)).length
  const data = broadcastDataFor(ride)
  await Promise.all([1, 2, 3].map((round, i) =>
    queues[QUEUE_NAMES.DISPATCH].add(
      'broadcast_ride', { ...data, broadcastRound: round },
      { jobId: `round-${rideId}-${round}-x${dropped}`, delay: i * 25_000, attempts: round === 1 ? 2 : 1, removeOnComplete: true },
    ),
  ))
  return true
}

// ── Admin cancel ────────────────────────────────────────────────────────────

const ADMIN_CANCELLABLE = new Set(['scheduled', 'requested', 'no_drivers'])

/**
 * Support cancels a ride that has no driver yet (still scheduled, being searched for, or found nobody) on the rider's behalf.
 * Free to the rider by definition: nobody was put out. A ride a driver already accepted is not covered here, because releasing
 * the driver and any fee is a separate decision.
 */
export async function adminCancelRide(rideId: bigint, adminId: bigint, reason: string, ip: string | null): Promise<void> {
  const ride = await repo.getRideCoreById(rideId)
  if (!ride) throw httpErr(404, 'Ride not found')
  if (!ADMIN_CANCELLABLE.has(ride.status)) throw httpErr(409, 'Only a ride that has no driver yet can be cancelled here', 'NOT_CANCELLABLE')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const upd = await client.query(`UPDATE rides SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1 AND status = $2`, [rideId, ride.status])
    if ((upd.rowCount ?? 0) === 0) throw httpErr(409, 'The ride changed while you were looking at it. Refresh and try again.', 'NOT_CANCELLABLE')
    await client.query(
      `INSERT INTO ride_cancellations (ride_id, actor, stage, cancelled_by_admin_id, reason_code, reason, fee_applicable, fee_amount, fee_waived)
       VALUES ($1, 'admin', $2, $3, 'admin_cancelled', $4, false, 0, false)`,
      [rideId, ride.status === 'scheduled' ? 'before_dispatch' : 'before_acceptance', adminId, reason],
    )
    await client.query(
      `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor, actor_id, note) VALUES ($1, $2, 'cancelled', 'admin', $3, $4)`,
      [rideId, ride.status, adminId, reason],
    )
    await client.query(`UPDATE ride_advance_meta SET status = 'cancelled', search_until = NULL WHERE ride_id = $1`, [rideId])
    // Nothing was delivered: the rider's offer goes back to them.
    await releaseForRide(client, rideId, 'admin cancelled')
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }

  count('admin_cancelled')
  const offered = await repo.cancelAllAssignments(rideId).catch(() => [] as string[])
  expireRideRequests(offered, rideId, 'cancelled')
  socketEvents.sendRideStatusUpdate(rideId.toString(), { status: 'cancelled', cancelledBy: 'admin', reasonCode: 'admin_cancelled' })
  const m = advanceMessages.cancelledByAdmin(new Date(ride.scheduled_for ?? ride.requested_at), reason)
  await tell('advance_cancelled', BigInt(ride.user_id), rideId, m.title, m.body)
  await recordAuditLog({
    adminId, action: 'ride.cancel', targetTable: 'rides', targetId: rideId,
    beforeState: { status: ride.status }, afterState: { status: 'cancelled' }, ipAddress: ip, reason,
  })
}

// ── Reminders ───────────────────────────────────────────────────────────────

const REMINDER_BATCH = 500

/**
 * Sends the 24 h and 1 h reminders. Runs from the 60 s sweep. Each ride is picked by its pickup time falling into a window (index-backed by
 * rides_scheduled_idx) and claimed with an UPDATE ... WHERE reminder_*_sent_at IS NULL, so two sweeps can never send the same reminder twice.
 * A booking made inside the window gets only its confirmation: the 15 / 30 minute guards on created_at stop the two arriving together.
 */
export async function sendAdvanceReminders(): Promise<{ day: number; hour: number }> {
  const out = { day: 0, hour: 0 }
  for (const spec of [
    { col: 'reminder_24h_sent_at', hours: 24 as const, from: `now() + interval '23 hours'`, to: `now() + interval '24 hours'`, guard: `interval '30 minutes'` },
    { col: 'reminder_1h_sent_at', hours: 1 as const, from: `now() + interval '20 minutes'`, to: `now() + interval '65 minutes'`, guard: `interval '15 minutes'` },
  ]) {
    const due = await pool.query<{ ride_id: string }>(
      `SELECT ram.ride_id::text AS ride_id FROM ride_advance_meta ram JOIN rides r ON r.id = ram.ride_id
        WHERE r.status = 'scheduled' AND ram.${spec.col} IS NULL
          AND r.scheduled_for > ${spec.from} AND r.scheduled_for <= ${spec.to}
          AND ram.created_at < now() - ${spec.guard}
        LIMIT ${REMINDER_BATCH}`,
    )
    if (due.rows.length === 0) continue
    const claimed = await pool.query<{ ride_id: string; user_id: string; scheduled_for: Date; dispatch_buffer_minutes: number }>(
      `UPDATE ride_advance_meta ram SET ${spec.col} = now() FROM rides r
        WHERE r.id = ram.ride_id AND ram.ride_id = ANY($1::bigint[]) AND ram.${spec.col} IS NULL AND r.status = 'scheduled'
        RETURNING ram.ride_id::text AS ride_id, r.user_id::text AS user_id, r.scheduled_for, ram.dispatch_buffer_minutes`,
      [due.rows.map(r => r.ride_id)],
    )
    for (const row of claimed.rows) {
      const m = advanceMessages.reminder(new Date(row.scheduled_for), row.dispatch_buffer_minutes, spec.hours)
      await tell('advance_reminder', BigInt(row.user_id), BigInt(row.ride_id), m.title, m.body)
      count(spec.hours === 24 ? 'reminder_24h' : 'reminder_1h')
      if (spec.hours === 24) out.day++; else out.hour++
    }
  }
  return out
}

// ── Still searching ─────────────────────────────────────────────────────────

/** What a dispatch round needs to run again for a ride, rebuilt from the ride row. */
export function broadcastDataFor(ride: { id: string | number | bigint; category_id: string | number | bigint; origin_lat: number; origin_lng: number; ride_type: string; is_return_cab: boolean; dest_lat?: number | null; dest_lng?: number | null; trip_hours?: number | string | null }): BroadcastJobData {
  const data: BroadcastJobData = {
    rideId: String(ride.id), categoryId: String(ride.category_id), originLat: ride.origin_lat, originLng: ride.origin_lng,
    rideType: ride.ride_type, isReturnCab: ride.is_return_cab, broadcastRound: 1,
  }
  if (ride.dest_lat != null) data.destinationLat = ride.dest_lat
  if (ride.dest_lng != null) data.destinationLng = ride.dest_lng
  if (ride.trip_hours != null) data.tripHours = Number(ride.trip_hours)
  return data
}

/**
 * An advance booking whose dispatch rounds found nobody should not close the ride 15 minutes before the rider's pickup: keep searching, in
 * fresh sets of rounds, until the pickup time plus the grace the admin set. Returns true when it queued another set (so the caller must not
 * close the ride). The first time it happens the rider is told we are still looking and ops are alerted, once.
 */
export async function keepSearchingAdvance(
  ride: { id: string | number | bigint; user_id: string | number | bigint; scheduled_for: string | Date | null },
  data: BroadcastJobData & { retryCycle?: number },
): Promise<boolean> {
  if (!ride.scheduled_for) return false
  const policy = await getAdvancePolicy()
  if (policy.searchGraceMin <= 0) return false
  const pickup = new Date(ride.scheduled_for)
  const deadline = new Date(pickup.getTime() + policy.searchGraceMin * 60_000)
  if (Date.now() + ADVANCE_RETRY_GAP_SECONDS * 1000 >= deadline.getTime()) return false

  const rideId = BigInt(ride.id)
  // One statement, so two overlapping retries cannot both think they are first: the stamp equals now() (this statement's time) only
  // when this statement is the one that set it.
  const res = await pool.query<{ first: boolean }>(
    `UPDATE ride_advance_meta SET search_until = $2, search_alerted_at = COALESCE(search_alerted_at, now())
      WHERE ride_id = $1
      RETURNING (search_alerted_at = now()) AS first`,
    [rideId, deadline],
  )
  if (res.rows.length === 0) return false // no advance meta: an ordinary ride, closes as before

  const cycle = (data.retryCycle ?? 0) + 1
  const gap = ADVANCE_RETRY_GAP_SECONDS * 1000
  // Touch the row so the stale-ride sweep measures from now, not from the first dispatch.
  await pool.query(`UPDATE rides SET updated_at = now() WHERE id = $1 AND status = 'requested'`, [rideId])
  await Promise.all([1, 2, 3].map((round, i) =>
    queues[QUEUE_NAMES.DISPATCH].add(
      'broadcast_ride', { ...data, broadcastRound: round, retryCycle: cycle },
      { jobId: `round-${rideId}-${round}-c${cycle}`, delay: gap + i * 25_000, attempts: round === 1 ? 2 : 1, removeOnComplete: true },
    ),
  ))
  count('search_retry')

  if (res.rows[0]?.first) {
    await repo.logStatusHistory({
      rideId, fromStatus: 'requested', toStatus: 'requested', actor: 'system',
      note: `No driver in the first rounds. Still searching until ${fmtClock(deadline)}.`,
    }).catch(() => undefined)
    const m = advanceMessages.searching(pickup)
    await tell('advance_searching', BigInt(ride.user_id), rideId, m.title, m.body)
    await notifyAllAdmins({
      type: 'advance_search_failed', title: 'Scheduled ride has no driver yet',
      body: `Ride #${rideId} (pickup ${fmtPickup(pickup)}) found nobody in the first rounds. Still searching; assign a driver from the Dispatch desk.`, rideId,
    }).catch(() => undefined)
  }
  return true
}
