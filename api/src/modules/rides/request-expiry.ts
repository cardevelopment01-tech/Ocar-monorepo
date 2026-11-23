import { socketEvents } from '@/websocket/socket.server'
import { sendRideRequestGonePush, type RideRequestGoneReason } from '@/modules/notifications/notifications.service'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'rides-request-expiry' })

/** A ride request is over for these drivers: end it on their open apps (socket) and silence the push on their locked phones. */
export function expireRideRequests(driverIds: Iterable<string>, rideId: bigint, reason: RideRequestGoneReason): void {
  const ids = [...driverIds]
  for (const id of ids) socketEvents.sendRequestExpired(id, rideId.toString())
  if (ids.length > 0) {
    void sendRideRequestGonePush(rideId.toString(), ids, reason).catch((err: unknown) => {
      log.error({ err, rideId }, 'ride-request gone push failed')
    })
  }
}
