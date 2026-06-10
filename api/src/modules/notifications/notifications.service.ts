import { pool } from '@/db/client'

export async function logNotification(params: {
  jobName: string
  recipientPhone?: string
  channel?: string
  templateKey?: string
  payload: Record<string, unknown>
}): Promise<bigint> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO notification_logs (job_name, recipient_phone, channel, template_key, payload)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      params.jobName,
      params.recipientPhone ?? null,
      params.channel ?? 'sms',
      params.templateKey ?? null,
      JSON.stringify(params.payload),
    ]
  )
  return BigInt(res.rows[0]!.id)
}

export async function markSent(id: bigint, providerResponse?: unknown): Promise<void> {
  await pool.query(
    `UPDATE notification_logs
     SET status = 'sent', sent_at = NOW(), provider_response = $2
     WHERE id = $1`,
    [id, providerResponse !== undefined ? JSON.stringify(providerResponse) : null]
  )
}

export async function markFailed(id: bigint, errorMessage: string): Promise<void> {
  await pool.query(
    `UPDATE notification_logs
     SET status = 'failed', error_message = $2
     WHERE id = $1`,
    [id, errorMessage]
  )
}
