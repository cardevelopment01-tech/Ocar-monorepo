import * as repo from './safety.repository'
import { getIO } from '@/websocket/socket.server'
import { pool } from '@/db/client'
import { notificationsQueue } from '@/jobs/queues'
import type { TriggerSosInput } from './safety.types'
import { logger } from '@/lib/logger'
import { assertRideParticipant } from './safety.guards'
import { client as redis } from '@/db/redis'
import { withTimeout } from '@/lib/with-timeout'
import { httpError } from '@/lib/errors'
import { recordAuditLog } from '@/lib/audit-log'

const log = logger.child({ module: 'sos-service' })

const SOS_DEDUP_WINDOW_SECONDS = 30
const SOS_HOURLY_CAP = 5
const SOS_HOURLY_WINDOW_SECONDS = 3600
// From the moment a driver accepts: a driver heading to pickup, or a rider waiting for one, can need help too.
const SOS_ELIGIBLE_STATUSES = new Set(['accepted', 'driver_arrived', 'in_progress', 'returning'])

/** Both coordinates, finite and on the globe, and not the 0,0 a phone reports when it has no position; otherwise null. */
function usableFix(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null
  return { lat, lng }
}

export async function triggerSos(input: TriggerSosInput) {
  const ride = await repo.getRideBasic(input.rideId)
  if (!ride) {
    throw httpError(404, 'Ride not found', 'RIDE_NOT_FOUND')
  }
  if (!SOS_ELIGIBLE_STATUSES.has(ride.status)) {
    throw httpError(400, 'SOS can only be triggered during an active ride', 'RIDE_NOT_ACTIVE')
  }

  const principal: { role: 'user' | 'driver'; id: bigint } =
    input.triggeredByUserId != null
      ? { role: 'user', id: input.triggeredByUserId }
      : { role: 'driver', id: input.triggeredByDriverId! }
  assertRideParticipant(ride, principal)

  // Dedup: a repeat press on the SAME ride inside the window collapses into the
  // existing alert — no new row, no re-page. Checked before the rate-limit
  // counter so a panicking rider mashing the button doesn't burn their budget.
  const existing = await repo.getActiveSosForRide(input.rideId, SOS_DEDUP_WINDOW_SECONDS)
  if (existing) {
    await repo.touchSosAlert(BigInt(existing.id))
    return existing
  }

  // Per-principal hourly fixed-window counter (§07 pattern — same shape as the
  // login-OTP limiter). Stops #03.1-enabled flooding across many rides, which
  // per-ride dedup alone can't. Five genuine SOS events/hour from one person is
  // already extreme and worth a human follow-up, not a real emergency we'd suppress.
  const rlKey = `sos:hourly:${principal.role}:${principal.id}`
  const count = await withTimeout(redis.incr(rlKey))
  if (count === 1) await withTimeout(redis.expire(rlKey, SOS_HOURLY_WINDOW_SECONDS))
  if (count > SOS_HOURLY_CAP) {
    throw httpError(429, 'Too many safety alerts. Contact support directly if this is urgent.', 'SOS_RATE_LIMITED')
  }

  // One place decides what counts as a fix, so the row, the job, the socket event and the log all agree. Bad coordinates never
  // refuse an emergency: they are simply treated as "no fix".
  const fix = usableFix(input.lat, input.lng)

  const alert = await repo.insertSosAlert({
    ride_id:             input.rideId,
    severity:            input.severity            ?? 'medium',
    triggered_by_user:   input.triggeredByUserId   ?? null,
    triggered_by_driver: input.triggeredByDriverId ?? null,
    location_lat:        fix?.lat ?? null,
    location_lng:        fix?.lng ?? null,
    notes:               input.notes               ?? null,
  })

  await repo.markRideSosTriggered(input.rideId)

  // Evidence trail for a safety report: who, which ride, when. Coordinates stay in the sos_alerts row, not in the log.
  log.info(
    { event: 'sos.triggered', sos_id: String(alert.id), ride_id: String(input.rideId), severity: alert.severity, by_role: principal.role, by_id: String(principal.id), has_location: fix !== null },
    'sos.triggered'
  )

  const triggeredUserId = input.triggeredByUserId ?? (ride.user_id != null ? BigInt(ride.user_id) : null)
  let userPhone = ''
  if (triggeredUserId != null) {
    const phoneRes = await pool.query<{ phone: string }>(
      `SELECT phone FROM users WHERE id = $1`,
      [triggeredUserId]
    )
    userPhone = phoneRes.rows[0]?.phone ?? ''
  }

  notificationsQueue.add(
    'sos_alert',
    {
      rideId:      String(input.rideId),
      userId:      String(triggeredUserId ?? ''),
      userPhone,
      triggeredByRole: principal.role,
      // null = the phone gave no fix. Never 0: a 0,0 map link sends people to the ocean.
      lat:         fix?.lat ?? null,
      lng:         fix?.lng ?? null,
      triggeredAt: new Date().toISOString(),
    },
    { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
  ).catch((err: unknown) => {
    log.error({ err }, 'failed to enqueue sos_alert job')
  })

  try {
    getIO().to('admin:ops').emit('sos:alert', {
      alertId:   String(alert.id),
      rideId:    String(input.rideId),
      severity:  alert.severity,
      triggeredBy: input.triggeredByUserId
        ? { role: 'user',   id: String(input.triggeredByUserId) }
        : { role: 'driver', id: String(input.triggeredByDriverId) },
      location: fix,
      notes:    input.notes ?? null,
      createdAt: alert.created_at,
    })
  } catch {
    // Socket emit failure must not block the SOS response
  }

  return alert
}

export async function listSosAlerts(opts: {
  status?: string
  limit:   number
  offset:  number
}) {
  return repo.getSosAlerts(opts)
}

// The update refuses an illegal move (already acknowledged, already closed) by matching no row. Tell "no such alert" (404) apart
// from "someone got there first" (409), so the page can reload instead of showing a vague failure.
async function refuseTransition(id: bigint): Promise<never> {
  const current = await repo.getSosStatus(id)
  if (current === null) throw httpError(404, 'SOS alert not found', 'SOS_ALERT_NOT_FOUND')
  throw httpError(409, `This alert is already ${current.replace(/_/g, ' ')}`, 'SOS_STATE_CONFLICT')
}

// Admin actions on an alert go in the audit log. A queue hiccup must never block someone responding to an emergency.
async function audit(action: string, id: bigint, adminId: bigint, after: Record<string, unknown>, reason: string | null, ip: string | null) {
  try {
    await recordAuditLog({ adminId, action, targetTable: 'sos_alerts', targetId: id, afterState: after, reason, ipAddress: ip })
  } catch (err) {
    log.error({ err, sosId: String(id) }, 'sos audit log write failed')
  }
}

export async function acknowledgeSosAlert(id: bigint, adminId: bigint, ip: string | null = null) {
  const alert = await repo.updateSosStatus(id, 'acknowledged', adminId)
  if (!alert) return refuseTransition(id)
  log.info({ event: 'sos.acknowledged', sos_id: String(id), admin_id: String(adminId) }, 'sos.acknowledged')
  await audit('sos.acknowledge', id, adminId, { status: 'acknowledged' }, null, ip)
  return alert
}

const SOS_NOTE_MAX = 500

export async function resolveSosAlert(
  id:      bigint,
  adminId: bigint,
  status:  'resolved' | 'false_alarm',
  note?:   string,
  ip:      string | null = null
) {
  const cleanNote = note?.trim().slice(0, SOS_NOTE_MAX) || undefined
  // Dismissing an emergency as a false alarm has to say why: it is what a later review reads.
  if (status === 'false_alarm' && !cleanNote) {
    throw httpError(400, 'Add a note saying why this is a false alarm', 'SOS_NOTE_REQUIRED')
  }
  const alert = await repo.updateSosStatus(id, status, adminId, cleanNote)
  if (!alert) return refuseTransition(id)
  log.info({ event: 'sos.resolved', sos_id: String(id), admin_id: String(adminId), status }, 'sos.resolved')
  await audit('sos.resolve', id, adminId, { status }, cleanNote ?? null, ip)
  return alert
}
