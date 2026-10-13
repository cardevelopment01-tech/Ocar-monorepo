import { z } from 'zod'
import { pool } from '@/db/client'
import { httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { recordAuditLog } from '@/lib/audit-log'
import { notifyOwner } from './notifications.service'

export const audienceSchema = z.object({
  role: z.enum(['driver', 'rider']),
  // Active drivers whose primary vehicle has no RC back on file (the RC front/back rollout reminder).
  missingRcBack: z.boolean().optional(),
}).strict()

export const broadcastSchema = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(300),
  category: z.enum(['announcement', 'offer']),
  audience: audienceSchema,
}).strict()

export type Audience = z.infer<typeof audienceSchema>
export type BroadcastInput = z.infer<typeof broadcastSchema>

// Offers are marketing: only inside 10:00-21:00 India time. Announcements (ops notices) go any time.
export function offersAllowedNow(now = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(now)) % 24
  return hour >= 10 && hour < 21
}

const PREF_CATEGORY = { announcement: 'announcements', offer: 'offers' } as const

// Recipient ids for an audience, minus anyone who switched this category off.
// Table/column names are hardcoded; only values are bound.
function audienceQuery(audience: Audience, category: BroadcastInput['category']): { text: string; values: unknown[] } {
  const ownerType = audience.role === 'driver' ? 'driver' : 'user'
  const table = audience.role === 'driver' ? 'drivers' : 'users'
  const rcBack = audience.role === 'driver' && audience.missingRcBack
    ? `AND EXISTS (SELECT 1 FROM driver_vehicles v WHERE v.driver_id = t.id AND v.is_primary)
       AND NOT EXISTS (SELECT 1 FROM driver_vehicles v JOIN driver_vehicle_documents x ON x.vehicle_id = v.id
                       WHERE v.driver_id = t.id AND v.is_primary AND x.doc_type = 'vehicle_rc_back')`
    : ''
  return {
    text: `SELECT t.id FROM ${table} t
           WHERE t.status = 'active' ${rcBack}
             AND NOT EXISTS (SELECT 1 FROM notification_preferences p
                             WHERE p.owner_type = $1 AND p.owner_id = t.id AND p.category = $2 AND NOT p.push_enabled)
           ORDER BY t.id`,
    values: [ownerType, PREF_CATEGORY[category]],
  }
}

export async function resolveAudience(audience: Audience, category: BroadcastInput['category']): Promise<string[]> {
  const q = audienceQuery(audience, category)
  const res = await pool.query<{ id: string }>(q.text, q.values)
  return res.rows.map((r) => r.id)
}

export async function previewBroadcast(audience: Audience, category: BroadcastInput['category']) {
  const ids = await resolveAudience(audience, category)
  return { recipientCount: ids.length, sendableNow: category === 'announcement' || offersAllowedNow() }
}

export async function createBroadcast(input: BroadcastInput, adminId: bigint, ip: string | null): Promise<{ id: string; recipientCount: number }> {
  if (input.category === 'offer' && !offersAllowedNow()) {
    throw httpError(422, 'Offers can only be sent between 10:00 and 21:00 IST', AppErrors.VALIDATION_ERROR.code)
  }
  const recipientCount = (await resolveAudience(input.audience, input.category)).length
  if (recipientCount === 0) throw httpError(422, 'No recipients match this audience', AppErrors.VALIDATION_ERROR.code)

  const res = await pool.query<{ id: string }>(
    `INSERT INTO notification_broadcasts (admin_id, title, body, category, audience, recipient_count)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [adminId.toString(), input.title, input.body, input.category, JSON.stringify(input.audience), recipientCount],
  )
  const id = res.rows[0]!.id

  await recordAuditLog({
    adminId, action: 'notification_broadcast', targetTable: 'notification_broadcasts', targetId: BigInt(id),
    afterState: { title: input.title, category: input.category, audience: input.audience, recipientCount }, ipAddress: ip,
  })
  const { pushQueue } = await import('@/jobs/queues')
  await pushQueue.add('broadcast_send', { broadcastId: id }, { attempts: 1 })
  return { id, recipientCount }
}

// Runs in the push worker. attempts: 1 on purpose -- a retry after a partial run would notify the
// first recipients twice. Recipients are re-resolved at run time, so an opt-out made between "send"
// and the run is honoured.
export async function runBroadcast(broadcastId: string): Promise<number> {
  const row = (await pool.query<{ title: string; body: string; category: BroadcastInput['category']; audience: Audience }>(
    'SELECT title, body, category, audience FROM notification_broadcasts WHERE id = $1', [broadcastId],
  )).rows[0]
  if (!row) return 0

  const ids = await resolveAudience(row.audience, row.category)
  const ownerType = row.audience.role === 'driver' ? 'driver' : 'user'
  for (let i = 0; i < ids.length; i += 20) {
    await Promise.all(ids.slice(i, i + 20).map((id) =>
      notifyOwner({ ownerType, ownerId: BigInt(id), type: row.category, title: row.title, body: row.body })
        .catch(() => undefined),
    ))
  }
  return ids.length
}
