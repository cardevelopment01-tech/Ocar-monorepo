import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { processCreateNextPartition } from '@/jobs/processors/partition-creator.processor'
import { processPurgeOldPartitions } from '@/jobs/processors/partition-purge.processor'

// Two job types share this queue, both scheduled monthly from server.ts:
//  - 'create_next_partition' — pre-creates next month's gps_tracks partition
//  - 'purge_old_partitions'  — drops gps_tracks partitions past the retention window
export const partitionMaintenanceWorker = new Worker(
  QUEUE_NAMES.PARTITION_MAINTENANCE,
  async (job) => {
    if (job.name === 'create_next_partition') {
      await processCreateNextPartition()
      return
    }
    if (job.name === 'purge_old_partitions') {
      await processPurgeOldPartitions()
    }
  },
  { connection: redisConnection }
)

partitionMaintenanceWorker.on('failed', (job, err) => {
  console.error(`[partition-maintenance] job ${job?.id} (${job?.name}) failed:`, err)
})
