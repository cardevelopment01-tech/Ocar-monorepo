import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { processCreateNextPartition } from '@/jobs/processors/partition-creator.processor'
import { processPurgeOldPartitions } from '@/jobs/processors/partition-purge.processor'
import { processPurgeOldNotifications } from '@/jobs/processors/notification-purge.processor'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger('partition-maintenance')

// Three job types share this queue (all periodic DB retention/maintenance
// work, not just gps_tracks partitions), scheduled from server.ts:
//  - 'create_next_partition'    — pre-creates next month's gps_tracks partition
//  - 'purge_old_partitions'     — drops gps_tracks partitions past the retention window
//  - 'purge_old_notifications'  — deletes notification_logs rows past their retention window
export const partitionMaintenanceWorker = new Worker(
  QUEUE_NAMES.PARTITION_MAINTENANCE,
  async (job) => {
    if (job.name === 'create_next_partition') {
      await processCreateNextPartition()
      return
    }
    if (job.name === 'purge_old_partitions') {
      await processPurgeOldPartitions()
      return
    }
    if (job.name === 'purge_old_notifications') {
      await processPurgeOldNotifications()
    }
  },
  { connection: redisConnection }
)

partitionMaintenanceWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id, jobName: job?.name }, 'partition-maintenance job failed')
})
