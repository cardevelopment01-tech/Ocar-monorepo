import * as repo from './safety.repository'
import { getIO } from '@/websocket/socket.server'
import { pool } from '@/db/client'
import { notificationsQueue } from '@/jobs/queues'
import type { TriggerSosInput } from './safety.types'
import { logger } from '@/lib/logger'
import { assertRideParticipant } from './safety.guards'
import { client as redis } from '@/db/redis'
import { httpError } from '@/lib/errors'

const log = logger.child({ module: 'sos-service' })

const SOS_DEDUP_WINDOW_SECONDS = 30
const SOS_HOURLY_CAP = 5
const SOS_HOURLY_WINDOW_SECONDS = 3600

export async function triggerSos(input: TriggerSosInput) {
  const ride = await repo.getRideBasic(input.rideId)
  if (!ride) {
    throw httpError(404, 'Ride not found', 'RIDE_NOT_FOUND')
  }
  if (ride.status !== 'in_progress' && ride.status !== 'driver_arrived' && ride.status !== 'returning') {
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
  const count = await redis.incr(rlKey)
  if (count === 1) await redis.expire(rlKey, SOS_HOURLY_WINDOW_SECONDS)
  if (count > SOS_HOURLY_CAP) {
    throw httpError(429, 'Too many safety alerts. Contact support directly if this is urgent.', 'SOS_RATE_LIMITED')
  }

  const alert = await repo.insertSosAlert({
    ride_id:             input.rideId,
    severity:            input.severity            ?? 'medium',
    triggered_by_user:   input.triggeredByUserId   ?? null,
    triggered_by_driver: input.triggeredByDriverId ?? null,
    location_lat:        input.lat                 ?? null,
    location_lng:        input.lng                 ?? null,
    notes:               input.notes               ?? null,
  })

  await repo.markRideSosTriggered(input.rideId)

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
      lat:         input.lat  ?? 0,
      lng:         input.lng  ?? 0,
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
      location: input.lat && input.lng ? { lat: input.lat, lng: input.lng } : null,
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

export async function acknowledgeSosAlert(id: bigint, adminId: bigint) {
  const alert = await repo.updateSosStatus(id, 'acknowledged', adminId)
  if (!alert) throw httpError(404, 'SOS alert not found', 'SOS_ALERT_NOT_FOUND')
  return alert
}

export async function resolveSosAlert(
  id:      bigint,
  adminId: bigint,
  status:  'resolved' | 'false_alarm',
  note?:   string
) {
  const alert = await repo.updateSosStatus(id, status, adminId, note)
  if (!alert) throw httpError(404, 'SOS alert not found', 'SOS_ALERT_NOT_FOUND')
  return alert
}
