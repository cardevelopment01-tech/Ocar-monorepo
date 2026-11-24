import { client as redis } from '@/db/redis'
import { driverSilentAlertKey } from '@/constants/redis-keys'
import { logger } from '@/lib/logger'
import { notifyAllAdmins, notifyOwner } from '@/modules/notifications/notifications.service'
import * as repo from './rides.repository'

const log = logger.child({ module: 'silent-drivers' })

// A phone in a dead zone or tunnel is quiet for a minute or two, so ops is paged from 3 minutes of silence, and again only after
// REPEAT_SECONDS if it is still silent. The 10-minute "possibly stuck" flag on the ride (cleanup worker) is separate and unchanged.
export const SILENT_ALERT_SECONDS = 180
const REPEAT_SECONDS = 30 * 60

export async function alertSilentDrivers(): Promise<void> {
  for (const d of await repo.findSilentOnTripDrivers(SILENT_ALERT_SECONDS)) {
    try {
      // NX: only the first sweep after the silence starts gets 'OK'. If Redis is down this throws and the driver is retried next minute.
      if ((await redis.set(driverSilentAlertKey(d.ride_id), '1', 'EX', REPEAT_SECONDS, 'NX')) !== 'OK') continue
      const mins = Math.max(1, Math.round(d.silent_seconds / 60))
      await notifyAllAdmins({
        type: 'driver_gps_silent',
        title: 'Driver location lost',
        body: `${d.driver_name ?? 'A driver'} (ride ${d.ride_id}) has sent no location for ${mins} min. Phone the driver.`,
        rideId: BigInt(d.ride_id),
      })
      // Best effort: a driver with no push token still gets the in-app item, and a failure here must not hide the admin page above.
      try {
        await notifyOwner({
          ownerType: 'driver',
          ownerId: BigInt(d.driver_id),
          type: 'location_paused',
          title: 'Your location stopped sharing',
          body: 'Open Ocar Driver so your trip keeps tracking.',
          rideId: BigInt(d.ride_id),
        })
      } catch (err) {
        log.warn({ err, rideId: d.ride_id }, 'driver nudge failed')
      }
    } catch (err) {
      log.error({ err, rideId: d.ride_id }, 'silent-driver alert failed') // one bad ride must not skip the rest
    }
  }
}
