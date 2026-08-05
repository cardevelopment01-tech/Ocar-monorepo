import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { clearAvailableEarnings, runScheduledSettlementBatch, submitProcessingSettlements } from '@/modules/payments/submodules/settlements/settlements.service'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger('settlements')

// Three job types share this queue, all scheduled from server.ts:
//  - 'clear_available_earnings' — every 15 min, flips pending->cleared
//  - 'run_scheduled_settlement_batch' — daily, sweeps cleared earnings into settlements (Task 6)
//  - 'submit_processing_settlements' — every 5 min, submits approved settlements to RazorpayX (Task 8)
export const settlementsWorker = new Worker(
  QUEUE_NAMES.SETTLEMENTS,
  async (job) => {
    if (job.name === 'clear_available_earnings') {
      await clearAvailableEarnings()
      return
    }
    if (job.name === 'run_scheduled_settlement_batch') {
      await runScheduledSettlementBatch()
      return
    }
    if (job.name === 'submit_processing_settlements') {
      await submitProcessingSettlements()
    }
  },
  { connection: redisConnection }
)

settlementsWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id, jobName: job?.name }, 'settlements job failed')
})
