import { auditQueue } from '@/jobs/queues'

export interface AuditLogJobData {
  adminId: string | null
  action: string
  targetTable: string
  targetId: string
  beforeState: Record<string, unknown> | null
  afterState: Record<string, unknown> | null
  ipAddress: string | null
}

// Builds the record synchronously (cheap, all context already in scope at the
// call site) and enqueues the actual DB write — never blocks the mutation
// that triggered it, and BullMQ retries on transient DB failure.
export async function recordAuditLog(params: {
  adminId: bigint | null
  action: string
  targetTable: string
  targetId: bigint
  beforeState?: Record<string, unknown> | null
  afterState?: Record<string, unknown> | null
  ipAddress?: string | null
}): Promise<void> {
  const data: AuditLogJobData = {
    adminId: params.adminId?.toString() ?? null,
    action: params.action,
    targetTable: params.targetTable,
    targetId: params.targetId.toString(),
    beforeState: params.beforeState ?? null,
    afterState: params.afterState ?? null,
    ipAddress: params.ipAddress ?? null,
  }
  await auditQueue.add('record', data, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } })
}
