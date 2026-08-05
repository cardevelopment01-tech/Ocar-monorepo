import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { pool } from '@/db/client'
import type { AuditLogJobData } from '@/lib/audit-log'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger('audit')

export const auditWorker = new Worker(
  QUEUE_NAMES.AUDIT,
  async job => {
    const data = job.data as AuditLogJobData
    await pool.query(
      `INSERT INTO admin_audit_log
         (admin_id, action, target_table, target_id, before_state, after_state, ip_address, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        data.adminId,
        data.action,
        data.targetTable,
        data.targetId,
        data.beforeState ? JSON.stringify(data.beforeState) : null,
        data.afterState ? JSON.stringify(data.afterState) : null,
        data.ipAddress,
        data.reason,
      ]
    )
  },
  { connection: redisConnection }
)

auditWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id }, 'audit job failed')
})
