import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { reconcilePendingRidePayments } from '@/modules/payments/payments.service'

export const paymentReconcileWorker = new Worker(
  QUEUE_NAMES.PAYMENTS,
  async () => {
    await reconcilePendingRidePayments()
  },
  { connection: redisConnection }
)

paymentReconcileWorker.on('failed', (job, err) => {
  console.error(`[payment-reconcile] job ${job?.id} failed:`, err)
})
