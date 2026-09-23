import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { createWorkerLogger } from '@/lib/worker-logger'
import * as service from '@/modules/call-masking/call-masking.service'

const log = createWorkerLogger('call-masking')

export const callMaskingWorker = new Worker(
  QUEUE_NAMES.CALL_MASKING,
  async (job) => {
    if (job.name === 'check_credit_balance') return service.checkCreditBalance()
  },
  { connection: redisConnection }
)

callMaskingWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id, jobName: job?.name }, 'call-masking job failed')
})
