import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { reconcilePendingRidePayments, reconcilePendingPayuPurchases } from '@/modules/payments/payments.service'
import { settleStrandedRideCompletions } from '@/modules/rides/rides.service'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger('payment-reconcile')

// Each sweep in its own try/catch: one failing must not skip the other.
export async function runPaymentReconcile(): Promise<void> {
  try {
    await reconcilePendingRidePayments()
  } catch (err) {
    log.error({ err }, 'ride payment reconcile failed')
  }
  try {
    await reconcilePendingPayuPurchases()
  } catch (err) {
    log.error({ err }, 'PayU purchase/top-up reconcile failed')
  }
  try {
    await settleStrandedRideCompletions()
  } catch (err) {
    log.error({ err }, 'stranded ride settlement sweep failed')
  }
}

export const paymentReconcileWorker = new Worker(
  QUEUE_NAMES.PAYMENTS,
  runPaymentReconcile,
  { connection: redisConnection }
)

paymentReconcileWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id }, 'payment-reconcile job failed')
})
