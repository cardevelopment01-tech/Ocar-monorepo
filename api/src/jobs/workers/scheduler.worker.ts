import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import * as repo from '@/modules/rides/rides.repository'
import {
  processDispatchScheduled,
  type DispatchScheduledJobData,
} from '@/jobs/processors/dispatch-scheduled.processor'

// Two job types share this queue:
//  - 'dispatch_scheduled_ride' — one-shot delayed job set at booking time, fires
//    the moment a specific ride enters its dispatch buffer window
//  - 'sweep_scheduled_rides'   — repeatable safety net (server restarts, delayed
//    job loss, clock skew) that catches any ride the delayed job missed
export const schedulerWorker = new Worker(
  QUEUE_NAMES.SCHEDULER,
  async (job) => {
    if (job.name === 'dispatch_scheduled_ride') {
      await processDispatchScheduled(job.data as DispatchScheduledJobData)
      return
    }

    if (job.name === 'sweep_scheduled_rides') {
      const due = await repo.getDueScheduledRides()
      for (const ride of due) {
        await processDispatchScheduled({ rideId: ride.id })
      }
    }
  },
  { connection: redisConnection }
)

schedulerWorker.on('failed', (job, err) => {
  console.error(`[scheduler] job ${job?.id} (${job?.name}) failed:`, err)
})
