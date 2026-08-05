import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import * as repo from '@/modules/rides/rides.repository'
import {
  forceResolveRide,
  expireStaleRequestedRide,
  expireStaleAcceptedOrArrivedRide,
} from '@/modules/rides/rides.service'
import { socketEvents } from '@/websocket/socket.server'
import {
  STALE_REQUESTED_MINUTES,
  STALE_ACCEPTED_HOURS,
  STALE_DRIVER_ARRIVED_HOURS,
} from '@/constants/limits'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger(undefined, 'cleanup')

// Ride stuck in_progress with no driver heartbeat (driver_location_snapshots.recorded_at):
//  - past FLAG_AFTER_SECONDS  -> flag for review, notify rider + admin ops
//  - past CANCEL_AFTER_SECONDS -> auto-cancel (no fare — the trip was never verifiable)
const FLAG_AFTER_SECONDS   = 10 * 60
const CANCEL_AFTER_SECONDS = 30 * 60

export const cleanupWorker = new Worker(
  QUEUE_NAMES.CLEANUP,
  async () => {
    const staleRides = await repo.findStaleInProgressRides(FLAG_AFTER_SECONDS)

    for (const ride of staleRides) {
      const rideId = BigInt(ride.id)

      if (!ride.review_flagged_at) {
        await repo.flagRideForReview(rideId, 'gps_stale')
        socketEvents.sendStuckRideFlagged(ride.id, { reason: 'gps_stale' })
        continue
      }

      const flaggedForSeconds = (Date.now() - new Date(ride.review_flagged_at).getTime()) / 1000
      if (flaggedForSeconds > CANCEL_AFTER_SECONDS - FLAG_AFTER_SECONDS) {
        await forceResolveRide(rideId, 'cancelled', 'timeout', 'auto-cancelled: no driver heartbeat')
      }
    }

    // Orphaned rides that never reached in_progress at all — broadcast job
    // died mid-flight, or driver accepted/arrived and the flow was
    // interrupted (crash, force-quit, network drop) before pickup.
    for (const ride of await repo.findStaleRequestedRides(STALE_REQUESTED_MINUTES)) {
      await expireStaleRequestedRide(BigInt(ride.id))
    }
    for (const ride of await repo.findStaleAcceptedOrArrivedRides(STALE_ACCEPTED_HOURS, STALE_DRIVER_ARRIVED_HOURS)) {
      await expireStaleAcceptedOrArrivedRide(BigInt(ride.id), ride.status, BigInt(ride.driver_id))
    }
  },
  { connection: redisConnection }
)

cleanupWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id }, 'cleanup job failed')
})
