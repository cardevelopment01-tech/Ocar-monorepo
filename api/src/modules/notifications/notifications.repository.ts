import { pool } from '@/db/client'

// ── Notification logs ─────────────────────────────────────────

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

// ── Device tokens (push) ────────────────────────────────────────

export type DeviceOwnerType = 'user' | 'driver' | 'admin'

export async function upsertDeviceToken(p: {
  ownerType: DeviceOwnerType
  ownerId: bigint
  token: string
  platform: string
}): Promise<void> {
  await pool.query(
    `INSERT INTO device_tokens (owner_type, owner_id, token, platform, last_seen_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (token) DO UPDATE
       SET owner_type = EXCLUDED.owner_type,
           owner_id   = EXCLUDED.owner_id,
           platform   = EXCLUDED.platform,
           last_seen_at = now()`,
    [p.ownerType, p.ownerId, p.token, p.platform]
  )
}

export async function deleteDeviceToken(token: string, ownerType: DeviceOwnerType, ownerId: bigint): Promise<void> {
  await pool.query(
    `DELETE FROM device_tokens WHERE token = $1 AND owner_type = $2 AND owner_id = $3`,
    [token, ownerType, ownerId]
  )
}

export async function deleteDeviceTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return
  await pool.query(`DELETE FROM device_tokens WHERE token = ANY($1::text[])`, [tokens])
}

export async function getTokensForOwner(ownerType: DeviceOwnerType, ownerId: bigint): Promise<string[]> {
  const res = await pool.query<{ token: string }>(
    `SELECT token FROM device_tokens WHERE owner_type = $1 AND owner_id = $2`,
    [ownerType, ownerId]
  )
  return res.rows.map(r => r.token)
}

export async function getAdminTokens(): Promise<string[]> {
  const res = await pool.query<{ token: string }>(
    `SELECT token FROM device_tokens WHERE owner_type = 'admin'`
  )
  return res.rows.map(r => r.token)
}
