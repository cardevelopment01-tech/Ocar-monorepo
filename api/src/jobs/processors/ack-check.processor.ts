import { client as redis } from '@/db/redis'
import { socketEvents } from '@/websocket/socket.server'
import * as repo from '@/modules/rides/rides.repository'
import { queues, QUEUE_NAMES } from '@/jobs/queues'
import { rideAckKey } from '@/constants/redis-keys'

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

  if (expiresMs - Date.now() > ACK_RETRY_MS) {
    await queues[QUEUE_NAMES.NOTIFICATIONS].add(
      'broadcast_ride_ack_check',
      data,
      { delay: ACK_RETRY_MS, attempts: 1, removeOnComplete: true, removeOnFail: true }
    )
  }
}
