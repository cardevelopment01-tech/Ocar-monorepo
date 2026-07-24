import { Worker } from 'bullmq'
import { QUEUE_NAMES, redisConnection } from '@/jobs/queues'
import { processBroadcast, type BroadcastJobData } from '@/jobs/processors/broadcast.processor'
import { processAckCheck, type AckCheckJobData } from '@/jobs/processors/ack-check.processor'

export const dispatchWorker = new Worker(
  QUEUE_NAMES.DISPATCH,
  async (job) => {
    if (job.name === 'broadcast_ride') {
      await processBroadcast(job.data as BroadcastJobData)
    } else if (job.name === 'broadcast_ride_ack_check') {
      await processAckCheck(job.data as AckCheckJobData)
    }
    // Unknown job names complete silently
  },
  {
    connection:  redisConnection,
    concurrency: 20,
  }
)

dispatchWorker.on('failed', (job, err) => {
  console.error(`[Worker] Dispatch job failed: ${job?.name ?? 'unknown'} id=${job?.id}`, err)
})
