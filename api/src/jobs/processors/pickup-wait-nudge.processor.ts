import * as repo from '@/modules/rides/rides.repository'
import { renderTemplate } from '@/modules/notifications/templates.service'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { queues, QUEUE_NAMES } from '@/jobs/queues'
import { PICKUP_WAIT_RADIUS_METRES } from '@/constants/limits'
import { pickupWaitFloor } from '@/lib/pickup-wait-floor'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'pickup-wait-nudge-processor' })

export interface PickupWaitNudgeJobData {
  rideId: string
  /** How many times this check has been put back; stops the job from chasing a clock that never starts. */
  attempt: number
}

// While the clock has not started the driver is not at the pickup yet; look again every 30 s for up to 12 minutes.
const RECHECK_MS = 30_000
const MAX_ATTEMPTS = 24

// Delayed job set when the driver marks arrived, due when the free minutes would end if the clock started at that tap. The wait clock
// really starts when the driver's position reaches the pickup (which can be later), and the ride may have started, been cancelled or
// been force-resolved in the meantime, so the job re-reads everything and only pushes when the rider is genuinely now being charged.
// Sent once: the rider gets a single calm note, never a running countdown. A push failure never retries into a duplicate.
export async function processPickupWaitNudge(data: PickupWaitNudgeJobData): Promise<void> {
  const rideId = BigInt(data.rideId)
  const ride = await repo.getRideCoreById(rideId)
  if (!ride || ride.status !== 'driver_arrived' || !ride.driver_arrived_at) return

  const terms = await repo.getPickupWaitTerms(rideId)
  // No terms (booked before waiting charges), no free window to announce the end of, or waiting costs nothing after it: nothing to say.
  if (!terms || terms.freeMin <= 0 || terms.perMin <= 0) return

  const checkAgain = async (delayMs: number) => {
    if (data.attempt >= MAX_ATTEMPTS) return
    await queues[QUEUE_NAMES.SCHEDULER].add(
      'pickup_wait_nudge',
      { rideId: data.rideId, attempt: data.attempt + 1 },
      { delay: delayMs, jobId: `pickup-wait-${data.rideId}-${data.attempt + 1}`, removeOnComplete: true, removeOnFail: 100 },
    )
  }

  const startedAt = await repo.getPickupWaitStartedAt(
    rideId, new Date(ride.driver_arrived_at), ride.origin_lat, ride.origin_lng, PICKUP_WAIT_RADIUS_METRES, ...pickupWaitFloor(ride))
  if (!startedAt) { await checkAgain(RECHECK_MS); return }

  const remainingMs = new Date(startedAt).getTime() + terms.freeMin * 60_000 - Date.now()
  // The clock started after the tap, so the free minutes are not over yet: come back when they are.
  if (remainingMs > 1_000) { await checkAgain(remainingMs); return }

  const rate = `₹${Number.isInteger(terms.perMin) ? terms.perMin : terms.perMin.toFixed(2)}`
  try {
    const { subject, body } = await renderTemplate('pickup_wait_started_rider', 'push', { rate })
    await notifyOwner({
      ownerType: 'user',
      ownerId: BigInt(ride.user_id),
      type: 'pickup_wait_started',
      title: subject ?? 'Free waiting is over',
      body,
      rideId,
      tag: `pickup-wait:${data.rideId}`,
    })
  } catch (err) {
    log.error({ err, rideId: data.rideId }, 'pickup wait push failed')
  }
}
