import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import * as repo from '@/modules/rides/rides.repository'
import {
  processDispatchScheduled,
  type DispatchScheduledJobData,
} from '@/jobs/processors/dispatch-scheduled.processor'
import { createWorkerLogger } from '@/lib/worker-logger'
import { findDocsNeedingExpiryNotice } from '@/modules/drivers/drivers.repository'
import { notifyDocumentExpiring, notifyDocumentExpired } from '@/modules/notifications/notifications.service'
import { docLabel } from '@/modules/admin/admin.service'

const log = createWorkerLogger('scheduler')

// Three job types share this queue:
//  - 'dispatch_scheduled_ride' — one-shot delayed job set at booking time, fires
//    the moment a specific ride enters its dispatch buffer window
//  - 'sweep_scheduled_rides'   — repeatable safety net (server restarts, delayed
//    job loss, clock skew) that catches any ride the delayed job missed
//  - 'sweep_document_expiry'   — daily reminder sweep for documents landing on a
//    30/15/7/1-day-to-expiry threshold, or expiring today
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
      return
    }

    if (job.name === 'sweep_document_expiry') {
      const notices = await findDocsNeedingExpiryNotice()
      for (const notice of notices) {
        const label = docLabel(notice.docType)
        if (notice.daysRemaining <= 0) {
          await notifyDocumentExpired(BigInt(notice.driverId), label, notice.route)
        } else {
          await notifyDocumentExpiring(BigInt(notice.driverId), label, notice.daysRemaining, notice.route)
        }
      }
    }
  },
  { connection: redisConnection }
)

schedulerWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id, jobName: job?.name }, 'scheduler job failed')
})
