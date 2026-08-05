import { Worker } from 'bullmq'
import { QUEUE_NAMES, redisConnection } from '@/jobs/queues'
import { processBroadcast, type BroadcastJobData } from '@/jobs/processors/broadcast.processor'
import { processAckCheck, type AckCheckJobData } from '@/jobs/processors/ack-check.processor'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger(undefined, 'dispatch')

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
  log.error({ err, jobId: job?.id, jobName: job?.name }, 'dispatch job failed')
})
