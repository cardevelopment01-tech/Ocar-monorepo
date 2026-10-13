import { Worker } from 'bullmq'
import { QUEUE_NAMES, redisConnection } from '@/jobs/queues'
import * as notifService from '@/modules/notifications/notifications.service'
import * as repo from '@/modules/notifications/notifications.repository'
import { runBroadcast } from '@/modules/notifications/broadcast.service'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger('push')

// Sends the FCM leg of notifyOwner(). A push that outlived its TTL is dropped (the device would
// have discarded it anyway); a send where nothing got through because of FCM/network trouble is
// retried by BullMQ (3 attempts, exponential backoff, set where the job is added).
export const pushWorker = new Worker(
  QUEUE_NAMES.PUSH,
  async (job) => {
    if (job.name === 'broadcast_send') {
      await runBroadcast((job.data as { broadcastId: string }).broadcastId)
      return
    }
    const data = job.data as notifService.PushJobData
    const ttl = data.msg.ttlSeconds
    if (ttl !== undefined && Date.now() - job.timestamp > ttl * 1000) {
      await repo.recordPushResult(data.notificationId, { successCount: 0, failureCount: 0, invalidTokens: 0, failureReason: 'expired_before_send' })
      return
    }

    const result = await notifService.deliverPush(data)
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
    const willRetry = !!result && result.successCount === 0 && result.transientFailure && !finalAttempt

    if (result && !willRetry) {
      await repo.recordPushResult(data.notificationId, {
        successCount: result.successCount,
        failureCount: result.failureCount,
        invalidTokens: result.invalidTokens.length,
        ...(result.successCount === 0 && result.transientFailure ? { failureReason: 'fcm_unavailable' } : {}),
      })
    }
    if (willRetry) throw new Error('fcm transient failure')
  },
  { connection: redisConnection, concurrency: 10 },
)

pushWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id, attempt: job?.attemptsMade }, 'push job failed')
})

pushWorker.on('error', (err) => {
  log.error({ err }, 'push worker error')
})
