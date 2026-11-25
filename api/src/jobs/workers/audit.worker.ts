import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { pool } from '@/db/client'
import { insertAuditRow, type AuditLogJobData } from '@/lib/audit-log'
import { createWorkerLogger } from '@/lib/worker-logger'
import { auditWriteFailuresTotal } from '@/observability/metrics'

const log = createWorkerLogger('audit')

// Only the fallback path: recordAuditLog() inserts directly and queues a row here when that insert failed.
export const auditWorker = new Worker(
  QUEUE_NAMES.AUDIT,
  async job => {
    await insertAuditRow(pool, job.data as AuditLogJobData)
  },
  { connection: redisConnection }
)

auditWorker.on('failed', (job, err) => {
  const final = job !== undefined && job.attemptsMade >= (job.opts.attempts ?? 1)
  if (final) auditWriteFailuresTotal.inc({ stage: 'queue' })
  log.error({ err, jobId: job?.id, final }, 'audit job failed')
})
