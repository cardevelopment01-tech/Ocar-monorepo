import { pool } from '@/db/client'

// ── Notification logs (delivery tracking + in-app feed) ─────────

export type NotifChannel = 'sms' | 'push' | 'voice' | 'email' | 'whatsapp' | 'in_app'
export type NotifOwnerType = 'user' | 'driver' | 'admin'

export async function logNotification(params: {
  jobName: string
  recipientPhone?: string
  channel?: NotifChannel
  payload: Record<string, unknown>
}): Promise<bigint> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO notification_logs (type, body, recipient_phone, channel, payload)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      params.jobName,
      params.jobName,
      params.recipientPhone ?? null,
      params.channel ?? 'sms',
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
     SET status = 'failed', failed_at = NOW(), failure_reason = $2
     WHERE id = $1`,
    [id, errorMessage]
  )
}

// ── In-app notification feed ─────────────────────────────────────

export interface NotificationFeedItem {
  id: string
  type: string
  title: string | null
  body: string
  payload: Record<string, unknown>
  rideId: string | null
  readAt: string | null
  createdAt: string
}

function toFeedItem(row: {
  id: string
  type: string
  title: string | null
  body: string
  payload: unknown
  ride_id: string | null
  read_at: Date | null
  created_at: Date
}): NotificationFeedItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    rideId: row.ride_id,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  }
}

export async function createInAppNotification(params: {
  ownerType: NotifOwnerType
  ownerId: bigint
  type: string
  title: string
  body: string
  payload?: Record<string, unknown>
  rideId?: bigint
}): Promise<NotificationFeedItem> {
  const res = await pool.query(
    `INSERT INTO notification_logs
       (owner_type, owner_id, channel, status, type, title, body, payload, ride_id, sent_at)
     VALUES ($1, $2, 'in_app', 'sent', $3, $4, $5, $6, $7, NOW())
     RETURNING id, type, title, body, payload, ride_id, read_at, created_at`,
    [
      params.ownerType,
      params.ownerId,
      params.type,
      params.title,
      params.body,
      JSON.stringify(params.payload ?? {}),
      params.rideId ?? null,
    ]
  )
  return toFeedItem(res.rows[0])
}

export async function listNotifications(params: {
  ownerType: NotifOwnerType
  ownerId: bigint
  cursor?: string
  limit: number
}): Promise<NotificationFeedItem[]> {
  const rows = params.cursor
    ? (
        await pool.query(
          `SELECT id, type, title, body, payload, ride_id, read_at, created_at
           FROM notification_logs
           WHERE owner_type = $1 AND owner_id = $2 AND channel = 'in_app'
             AND created_at < (SELECT created_at FROM notification_logs WHERE id = $3)
           ORDER BY created_at DESC
           LIMIT $4`,
          [params.ownerType, params.ownerId, params.cursor, params.limit]
        )
      ).rows
    : (
        await pool.query(
          `SELECT id, type, title, body, payload, ride_id, read_at, created_at
           FROM notification_logs
           WHERE owner_type = $1 AND owner_id = $2 AND channel = 'in_app'
           ORDER BY created_at DESC
           LIMIT $3`,
          [params.ownerType, params.ownerId, params.limit]
        )
      ).rows
  return rows.map(toFeedItem)
}

export async function getUnreadCount(ownerType: NotifOwnerType, ownerId: bigint): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM notification_logs
     WHERE owner_type = $1 AND owner_id = $2 AND channel = 'in_app' AND read_at IS NULL`,
    [ownerType, ownerId]
  )
  return parseInt(res.rows[0]!.count, 10)
}

export async function markRead(id: bigint, ownerType: NotifOwnerType, ownerId: bigint): Promise<boolean> {
  const res = await pool.query(
    `UPDATE notification_logs
     SET read_at = NOW()
     WHERE id = $1 AND owner_type = $2 AND owner_id = $3 AND channel = 'in_app' AND read_at IS NULL`,
    [id, ownerType, ownerId]
  )
  return (res.rowCount ?? 0) > 0
}

export async function markAllRead(ownerType: NotifOwnerType, ownerId: bigint): Promise<void> {
  await pool.query(
    `UPDATE notification_logs
     SET read_at = NOW()
     WHERE owner_type = $1 AND owner_id = $2 AND channel = 'in_app' AND read_at IS NULL`,
    [ownerType, ownerId]
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

export async function getAllAdminIds(): Promise<bigint[]> {
  const res = await pool.query<{ id: string }>(`SELECT id::text FROM admins`)
  return res.rows.map(r => BigInt(r.id))
}
