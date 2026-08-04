import { client as redis } from '@/db/redis'
import { socketEvents } from '@/websocket/socket.server'
import * as repo from '@/modules/rides/rides.repository'
import { queues, QUEUE_NAMES } from '@/jobs/queues'
import { rideAckKey, ridePushSentKey } from '@/constants/redis-keys'
import { BROADCAST_WINDOW_SECONDS } from '@/constants/limits'
import { pushToTokens } from '@/modules/notifications/notifications.service'
import { getTokensForOwner } from '@/modules/notifications/notifications.repository'

const ACK_RETRY_MS = 4_000

export interface AckCheckJobData {
  rideId: string
  driverId: string
  expiresAt: string
  pickup: string
  drop: string
  pickupLat: number
  pickupLng: number
  destinationLat?: number
  destinationLng?: number
  distanceToPickup: number
  estimatedFare: number
  rideType: string
  isReturnCab: boolean
}

export async function processAckCheck(data: AckCheckJobData): Promise<void> {
  const expiresMs = new Date(data.expiresAt).getTime()
  if (Date.now() >= expiresMs) return

  // Key deleted by ACK handler → driver confirmed receipt → stop
  const exists = await redis.exists(rideAckKey(data.rideId, data.driverId))
  if (!exists) return

  const ride = await repo.getRideById(BigInt(data.rideId))
  if (!ride || ride.status !== 'requested') {
    await redis.del(rideAckKey(data.rideId, data.driverId))
    return
  }

  const timeoutSeconds = Math.max(1, Math.floor((expiresMs - Date.now()) / 1000))
  const payload: Record<string, unknown> = {
    rideId:           data.rideId,
    pickup:           data.pickup,
    drop:             data.drop,
    pickupLat:        data.pickupLat,
    pickupLng:        data.pickupLng,
    distanceToPickup: data.distanceToPickup,
    estimatedFare:    data.estimatedFare,
    rideType:         data.rideType,
    isReturnCab:      data.isReturnCab,
    expiresAt:        data.expiresAt,
    timeoutSeconds,
  }
  if (data.destinationLat !== undefined) payload['destinationLat'] = data.destinationLat
  if (data.destinationLng !== undefined) payload['destinationLng'] = data.destinationLng

  socketEvents.sendRideRequest(data.driverId, payload)

  // Fire at most ONE fallback push per ride+driver, only on the first time this
  // loop runs (~4s after the initial broadcast). A driver whose socket is alive
  // acks within that window and this never fires for them — it only reaches
  // drivers whose socket genuinely never delivered the room emit. Guarded with
  // SET NX so the 4s retry loop never sends a second popup for the same ride.
  const firstFire = await redis.set(
    ridePushSentKey(data.rideId, data.driverId), '1',
    'EX', BROADCAST_WINDOW_SECONDS + 30, 'NX'
  )
  if (firstFire === 'OK') {
    try {
      const tokens = await getTokensForOwner('driver', BigInt(data.driverId))
      await pushToTokens(tokens, {
        title: 'New ride request',
        body: `${data.pickup} → ${data.drop}`,
        tag: `ride-${data.rideId}`,
        ttlSeconds: Math.min(timeoutSeconds, 30),
        data: { type: 'ride_request', rideId: data.rideId },
      })
    } catch (err) {
      console.error('[ACK-CHECK] fallback push failed:', err instanceof Error ? err.message : 'unknown error')
    }
  }

  if (expiresMs - Date.now() > ACK_RETRY_MS) {
    await queues[QUEUE_NAMES.DISPATCH].add(
      'broadcast_ride_ack_check',
      data,
      { delay: ACK_RETRY_MS, attempts: 1, removeOnComplete: true, removeOnFail: true }
    )
  }
}
