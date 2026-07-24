import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { clearAvailableEarnings } from '@/modules/payments/submodules/settlements/settlements.service'

// Two job types share this queue, both scheduled from server.ts:
//  - 'clear_available_earnings' — every 15 min, flips pending->cleared
//  - 'run_scheduled_settlement_batch' — daily, sweeps cleared earnings into settlements (Task 6)
export const settlementsWorker = new Worker(
  QUEUE_NAMES.SETTLEMENTS,
  async (job) => {
    if (job.name === 'clear_available_earnings') {
      await clearAvailableEarnings()
    }
  },
  { connection: redisConnection }
)

settlementsWorker.on('failed', (job, err) => {
  console.error(`[settlements] job ${job?.id} (${job?.name}) failed:`, err)
})
