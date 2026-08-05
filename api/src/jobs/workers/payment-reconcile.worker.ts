import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { reconcilePendingRidePayments } from '@/modules/payments/payments.service'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger(undefined, 'payment-reconcile')

export const paymentReconcileWorker = new Worker(
  QUEUE_NAMES.PAYMENTS,
  async () => {
    await reconcilePendingRidePayments()
  },
  { connection: redisConnection }
)

paymentReconcileWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id }, 'payment-reconcile job failed')
})
