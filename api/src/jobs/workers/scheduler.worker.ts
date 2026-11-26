import { sendReservationReminders, sendHeadOutNudges, dispatchReservedRidesDue } from '@/modules/rides/reservation.service'
import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import * as repo from '@/modules/rides/rides.repository'
import {
  processDispatchScheduled,
  type DispatchScheduledJobData,
} from '@/jobs/processors/dispatch-scheduled.processor'
import {
  processTripWindowNudge,
  type TripWindowNudgeJobData,
} from '@/jobs/processors/trip-window-nudge.processor'
import {
  processPickupWaitNudge,
  type PickupWaitNudgeJobData,
} from '@/jobs/processors/pickup-wait-nudge.processor'
import { createWorkerLogger } from '@/lib/worker-logger'
import { sendAdvanceReminders } from '@/modules/rides/advance.service'
import { findDocsNeedingExpiryNotice } from '@/modules/drivers/drivers.repository'
import { notifyDocumentExpiring, notifyDocumentExpired } from '@/modules/notifications/notifications.service'
import { docLabel } from '@/modules/admin/admin.service'
import { runAdminDigest } from '@/modules/analytics/admin-digest'
import { sweepStaleSosAlerts, sweepBreachedDisputeSlas } from '@/modules/safety/safety.sweeps'
import { endExpiredOffers, releaseStaleReservations } from '@/modules/offers/offers.worker'
import { issueCommissionInvoices } from '@/modules/packages/package-invoice.service'
import { verifyAuditChainJob, archiveAuditDayJob } from '@/jobs/processors/audit-maintenance.processor'

const log = createWorkerLogger('scheduler')

// Six job types share this queue ('trip_window_nudge': push at T-15 and at the end of a round
// trip's booked window, one-shot delayed jobs set when the trip starts):
//  - 'dispatch_scheduled_ride' — one-shot delayed job set at booking time, fires
//    the moment a specific ride enters its dispatch buffer window
//  - 'sweep_scheduled_rides'   — repeatable safety net (server restarts, delayed
//    job loss, clock skew) that catches any ride the delayed job missed
//  - 'sweep_document_expiry'   — daily reminder sweep for documents landing on a
//    30/15/7/1-day-to-expiry threshold, or expiring today
//  - 'sweep_stale_sos'         — §03.4: page all admins for SOS alerts still
//    unacknowledged 5+ minutes after being triggered
//  - 'sweep_dispute_sla'       — §03.4: page all admins for disputes past their
//    sla_due_at that haven't been resolved/withdrawn
export const schedulerWorker = new Worker(
  QUEUE_NAMES.SCHEDULER,
  async (job) => {
    if (job.name === 'dispatch_scheduled_ride') {
      await processDispatchScheduled(job.data as DispatchScheduledJobData)
      return
    }

    if (job.name === 'trip_window_nudge') {
      await processTripWindowNudge(job.data as TripWindowNudgeJobData)
      return
    }

    // One-shot delayed job set when the driver marks arrived: tells the rider once that the free waiting minutes are over.
    if (job.name === 'pickup_wait_nudge') {
      await processPickupWaitNudge(job.data as PickupWaitNudgeJobData)
      return
    }

    if (job.name === 'sweep_scheduled_rides') {
      const due = await repo.getDueScheduledRides()
      for (const ride of due) {
        await processDispatchScheduled({ rideId: ride.id })
      }
      // Reminders ride on the same minute sweep; a failure here must never stop dispatch above, so it is isolated.
      await sendAdvanceReminders().catch((err: unknown) => log.error({ err }, 'advance reminders failed'))
      await dispatchReservedRidesDue((id) => processDispatchScheduled({ rideId: id })).catch((err: unknown) => log.error({ err }, 'early go-live failed'))
      await sendReservationReminders().catch((err: unknown) => log.error({ err }, 'reservation reminders failed'))
      await sendHeadOutNudges().catch((err: unknown) => log.error({ err }, 'head-out nudges failed'))
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
      return
    }

    if (job.name === 'sweep_stale_sos') {
      await sweepStaleSosAlerts()
      return
    }

    if (job.name === 'sweep_dispute_sla') {
      await sweepBreachedDisputeSlas()
      return
    }

    // Offers: give back reservations of rides that never ran, and end offers past their end time.
    if (job.name === 'sweep_offer_reservations') {
      await releaseStaleReservations()
      return
    }
    if (job.name === 'sweep_offer_expiry') {
      await endExpiredOffers()
      return
    }

    if (job.name === 'admin_daily_digest') {
      await runAdminDigest()
      return
    }

    // GST commission invoices: one consolidated invoice per driver for each period that has ended (monthly by default).
    if (job.name === 'issue_commission_invoices') {
      await issueCommissionInvoices()
      return
    }

    // Admin audit trail: nightly hash-chain verification, then a copy of yesterday's rows to S3.
    if (job.name === 'audit_verify_chain') {
      await verifyAuditChainJob()
      return
    }
    if (job.name === 'audit_archive_day') {
      await archiveAuditDayJob()
      return
    }
  },
  { connection: redisConnection }
)

schedulerWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id, jobName: job?.name }, 'scheduler job failed')
})
