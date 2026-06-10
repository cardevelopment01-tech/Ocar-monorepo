import * as repo from './safety.repository'
import { getIO } from '@/websocket/socket.server'
import type { TriggerSosInput } from './safety.types'

export async function triggerSos(input: TriggerSosInput) {
  const ride = await repo.getRideBasic(input.rideId)
  if (!ride) {
    throw Object.assign(new Error('Ride not found'), { statusCode: 404 })
  }
  if (ride.status !== 'in_progress' && ride.status !== 'driver_arrived') {
    throw Object.assign(new Error('SOS can only be triggered during an active ride'), {
      statusCode: 400, code: 'RIDE_NOT_ACTIVE',
    })
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
  if (!alert) throw Object.assign(new Error('SOS alert not found'), { statusCode: 404 })
  return alert
}

export async function resolveSosAlert(
  id:      bigint,
  adminId: bigint,
  status:  'resolved' | 'false_alarm',
  note?:   string
) {
  const alert = await repo.updateSosStatus(id, status, adminId, note)
  if (!alert) throw Object.assign(new Error('SOS alert not found'), { statusCode: 404 })
  return alert
}
