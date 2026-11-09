import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import * as repo from '@/modules/rides/rides.repository'
import {
  expireStaleRequestedRide,
  expireStaleAcceptedOrArrivedRide,
  pauseAvailability,
  goOffline,
} from '@/modules/rides/rides.service'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { socketEvents, hasLiveDriverSocket } from '@/websocket/socket.server'
import {
  STALE_REQUESTED_MINUTES,
  DISPATCH_WATCHDOG_SECONDS,
  STALE_ACCEPTED_HOURS,
  STALE_DRIVER_ARRIVED_HOURS,
  IDLE_HEARTBEAT_PAUSE_SECONDS,
  IDLE_HEARTBEAT_OFFLINE_MINUTES,
} from '@/constants/limits'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger('cleanup')

// Ride stuck in_progress with no driver heartbeat (driver_location_snapshots.recorded_at):
// past FLAG_AFTER_SECONDS -> flag for review, notify rider + admin ops.
// Deliberately does NOT auto-cancel past any further threshold — the driver app
// is a browser tab with no background-GPS capability, so GPS silence past 30
// minutes is close to guaranteed on any real multi-hour trip once the tab
// backgrounds (screen lock, switching to Maps for turn-by-turn). Auto-cancelling
// a live ride on that signal alone force-ends real trips with zero fare to the
// driver. A flagged ride is resolved by a human at ops, never by a timer.
const FLAG_AFTER_SECONDS = 10 * 60

export const cleanupWorker = new Worker(
  QUEUE_NAMES.CLEANUP,
  async () => {
    const staleRides = await repo.findStaleInProgressRides(FLAG_AFTER_SECONDS)

    for (const ride of staleRides) {
      if (!ride.review_flagged_at) {
        await repo.flagRideForReview(BigInt(ride.id), 'gps_stale')
        socketEvents.sendStuckRideFlagged(ride.id, { reason: 'gps_stale' })
      }
    }

    // Orphaned rides that never reached in_progress at all — broadcast job
    // died mid-flight, or driver accepted/arrived and the flow was
    // interrupted (crash, force-quit, network drop) before pickup.
    for (const ride of await repo.findStaleRequestedRides(STALE_REQUESTED_MINUTES)) {
      await expireStaleRequestedRide(BigInt(ride.id))
    }
    // Dispatch watchdog: a flagged ride whose rounds are over and has no open offer is closed now (rider told, offer given back),
    // not after the 20-minute sweep above.
    for (const ride of await repo.findStuckDispatchRides(DISPATCH_WATCHDOG_SECONDS)) {
      log.warn({ rideId: ride.id }, 'dispatch watchdog closing a ride with no live offers')
      try {
        await expireStaleRequestedRide(BigInt(ride.id), 'auto-expired: dispatch watchdog (no round running, no open offers)', true)
      } catch (err) {
        log.error({ err, rideId: ride.id }, 'dispatch watchdog failed for a ride') // one bad ride must not skip the rest of the sweep
      }
    }
    for (const ride of await repo.findStaleAcceptedOrArrivedRides(STALE_ACCEPTED_HOURS, STALE_DRIVER_ARRIVED_HOURS)) {
      await expireStaleAcceptedOrArrivedRide(BigInt(ride.id), ride.status, BigInt(ride.driver_id))
    }

    // Idle-driver heartbeat: the client's own visibilitychange handler
    // (apps/driver/src/App.tsx) is the primary signal and reacts within a second —
    // this sweep only catches drivers who never got to report anything (real crash,
    // OS-killed process, battery death). Short tier pulls them out of the matching
    // pool; only the long tier actually ends the session.
    // A driver whose app is connected right now is not silent, whatever their last location fix says (a fix can be dropped for poor
    // accuracy while the driver sits still). Unknown presence counts as "not connected": the old behaviour.
    const notConnected = async (id: string) => !(await hasLiveDriverSocket(id, false))
    for (const d of await repo.findStaleOnlineDrivers(IDLE_HEARTBEAT_PAUSE_SECONDS)) {
      if (!(await notConnected(d.driver_id))) continue
      await pauseAvailability(BigInt(d.driver_id))
    }
    for (const d of await repo.findStaleOnlineDrivers(IDLE_HEARTBEAT_OFFLINE_MINUTES * 60)) {
      if (!(await notConnected(d.driver_id))) continue
      await goOffline(BigInt(d.driver_id), 'stale_heartbeat')
      // Hardcoded copy, not a notification_templates row (unlike most other notification
      // types) — deliberately out of scope for this fix; revisit if ops needs to edit this wording.
      await notifyOwner({
        ownerType: 'driver',
        ownerId:   BigInt(d.driver_id),
        type:      'session_ended_stale',
        title:     'You went offline',
        body:      "We lost connection to your device and paused your online status. Tap Go Online to start again.",
        tag:       'session-status',
      }).catch((err: unknown) => log.error({ err, driverId: d.driver_id }, 'stale-offline notify failed'))
    }
  },
  { connection: redisConnection }
)

cleanupWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id }, 'cleanup job failed')
})
