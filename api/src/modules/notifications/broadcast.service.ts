import { z } from 'zod'
import { pool } from '@/db/client'
import { httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { recordAuditLog } from '@/lib/audit-log'
import { logger } from '@/lib/logger'
import {
  BROADCAST_CHUNK_PAUSE_MS, BROADCAST_CHUNK_SIZE, BROADCAST_DAILY_CAP_PER_PERSON, PUSH_TOKEN_FRESH_DAYS,
} from '@/constants/limits'
import { docIssueExistsSql } from '@/modules/drivers/drivers.repository'
import { notifyOwner } from './notifications.service'

const log = logger.child({ module: 'broadcast' })

// ─── Audience ────────────────────────────────────────────────────────────────────────────────

/** '98610 03979', '9861003979', '+919861003979' and '919861003979' all become '+919861003979'; anything else is null. */
export function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  const e164 = digits.length === 10 ? `+91${digits}` : digits.length === 12 && digits.startsWith('91') ? `+${digits}` : null
  return e164 !== null && /^\+91[6-9]\d{9}$/.test(e164) ? e164 : null
}

const idList = z.array(z.number().int().positive()).min(1).max(100)

export const audienceSchema = z.object({
  role: z.enum(['driver', 'rider']),
  // Drivers: active drivers whose primary vehicle has no RC back on file (the RC front/back rollout reminder).
  missingRcBack: z.boolean().optional(),
  // Drivers: active drivers a document keeps from going online (expired, rejected, waiting for review, RC back missing).
  docIssues: z.boolean().optional(),
  // Drivers: operating city / category of the primary vehicle.
  cityIds: idList.optional(),
  categoryIds: idList.optional(),
  // Riders: booked at least once in the last N days.
  bookedInLastDays: z.number().int().min(1).max(365).optional(),
  // Specific people by phone number (a test to yourself, or a one-off reminder). Cannot be combined with any other filter.
  phones: z.array(z.string().transform((p, ctx) => {
    const n = normalizeIndianPhone(p)
    if (n === null) ctx.addIssue({ code: 'custom', message: 'Not a valid Indian mobile number' })
    return n ?? p
  })).min(1).max(10).optional(),
}).strict().superRefine((a, ctx) => {
  const driverOnly = !!(a.missingRcBack || a.docIssues || a.cityIds || a.categoryIds)
  if (a.role === 'rider' && driverOnly) ctx.addIssue({ code: 'custom', message: 'Driver filters cannot be used for riders' })
  if (a.role === 'driver' && a.bookedInLastDays) ctx.addIssue({ code: 'custom', message: 'The booking filter is for riders only' })
  if (a.phones && (driverOnly || a.bookedInLastDays)) ctx.addIssue({ code: 'custom', message: 'Phone numbers cannot be combined with other filters' })
})

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

// One row per active person the audience matches, with three facts about them. Table and column names are hardcoded; only values are
// bound. The daily limit does not apply to sends aimed at specific phone numbers.
function candidateQuery(audience: Audience, category: BroadcastInput['category']): { text: string; values: unknown[] } {
  const ownerType = audience.role === 'driver' ? 'driver' : 'user'
  const table = audience.role === 'driver' ? 'drivers' : 'users'
  const values: unknown[] = [ownerType, PREF_CATEGORY[category], PUSH_TOKEN_FRESH_DAYS]
  const bind = (v: unknown): string => { values.push(v); return `$${values.length}` }

  const filters: string[] = []
  if (audience.phones) filters.push(`AND t.phone = ANY(${bind(audience.phones)}::text[])`)
  if (audience.role === 'driver') {
    if (audience.missingRcBack) {
      filters.push(`AND EXISTS (SELECT 1 FROM driver_vehicles v WHERE v.driver_id = t.id AND v.is_primary)
       AND NOT EXISTS (SELECT 1 FROM driver_vehicles v JOIN driver_vehicle_documents x ON x.vehicle_id = v.id
                       WHERE v.driver_id = t.id AND v.is_primary AND x.doc_type = 'vehicle_rc_back')`)
    }
    if (audience.docIssues) filters.push(`AND ${docIssueExistsSql('t.id')}`)
    if (audience.cityIds?.length) filters.push(`AND t.city_id = ANY(${bind(audience.cityIds)}::bigint[])`)
    if (audience.categoryIds?.length) {
      filters.push(`AND EXISTS (SELECT 1 FROM driver_vehicles v WHERE v.driver_id = t.id AND v.is_primary AND v.category_id = ANY(${bind(audience.categoryIds)}::bigint[]))`)
    }
  } else if (audience.bookedInLastDays) {
    filters.push(`AND EXISTS (SELECT 1 FROM rides r WHERE r.user_id = t.id AND r.requested_at > now() - make_interval(days => ${bind(audience.bookedInLastDays)}::int))`)
  }

  const capped = audience.phones
    ? 'false'
    : `(SELECT count(*) FROM notification_logs l WHERE l.owner_type = $1 AND l.owner_id = t.id AND l.channel = 'in_app'
                AND l.broadcast_id IS NOT NULL AND l.created_at > now() - interval '24 hours') >= ${bind(BROADCAST_DAILY_CAP_PER_PERSON)}::int`

  return {
    text: `SELECT t.id,
             EXISTS (SELECT 1 FROM notification_preferences p
                     WHERE p.owner_type = $1 AND p.owner_id = t.id AND p.category = $2 AND NOT p.push_enabled) AS opted_out,
             ${capped} AS capped,
             EXISTS (SELECT 1 FROM device_tokens dt
                     WHERE dt.owner_type = $1 AND dt.owner_id = t.id AND dt.last_seen_at > now() - make_interval(days => $3::int)) AS has_device
           FROM ${table} t
           WHERE t.status = 'active' ${filters.join(' ')}`,
    values,
  }
}

export type AudiencePreview = {
  /** People the audience matches (active, before any are left out). */
  matched: number
  /** People who will be notified. */
  recipientCount: number
  /** Of those, how many have a phone seen recently, so they also get the push. */
  withDevice: number
  /** The rest only get the in-app notification (and riders have no in-app list yet, so in practice they see nothing). */
  inAppOnly: number
  skippedOptedOut: number
  skippedCapped: number
  dailyCap: number
  sendableNow: boolean
  /** Phone numbers typed in that match no active account. */
  phonesNotFound: string[]
}

export async function resolveAudience(audience: Audience, category: BroadcastInput['category']): Promise<string[]> {
  const q = candidateQuery(audience, category)
  const res = await pool.query<{ id: string }>(
    `SELECT c.id FROM (${q.text}) c WHERE NOT c.opted_out AND NOT c.capped ORDER BY c.id`, q.values,
  )
  return res.rows.map((r) => r.id)
}

export async function previewBroadcast(audience: Audience, category: BroadcastInput['category']): Promise<AudiencePreview> {
  const q = candidateQuery(audience, category)
  const res = await pool.query<{ matched: number; opted_out: number; capped: number; recipients: number; with_device: number }>(
    `SELECT count(*)::int AS matched,
            count(*) FILTER (WHERE c.opted_out)::int AS opted_out,
            count(*) FILTER (WHERE NOT c.opted_out AND c.capped)::int AS capped,
            count(*) FILTER (WHERE NOT c.opted_out AND NOT c.capped)::int AS recipients,
            count(*) FILTER (WHERE NOT c.opted_out AND NOT c.capped AND c.has_device)::int AS with_device
       FROM (${q.text}) c`, q.values,
  )
  const r = res.rows[0]!
  let phonesNotFound: string[] = []
  if (audience.phones) {
    const found = await pool.query<{ phone: string }>(
      `SELECT phone FROM ${audience.role === 'driver' ? 'drivers' : 'users'} WHERE status = 'active' AND phone = ANY($1::text[])`, [audience.phones],
    )
    const have = new Set(found.rows.map((f) => f.phone))
    phonesNotFound = audience.phones.filter((p) => !have.has(p))
  }
  return {
    matched: r.matched,
    recipientCount: r.recipients,
    withDevice: r.with_device,
    inAppOnly: r.recipients - r.with_device,
    skippedOptedOut: r.opted_out,
    skippedCapped: r.capped,
    dailyCap: BROADCAST_DAILY_CAP_PER_PERSON,
    sendableNow: category === 'announcement' || offersAllowedNow(),
    phonesNotFound,
  }
}

/** The audience as an admin may see it again: typed phone numbers are replaced by how many there were. */
export function maskAudience(audience: Audience): Omit<Audience, 'phones'> & { phoneCount?: number } {
  const { phones, ...rest } = audience
  return phones ? { ...rest, phoneCount: phones.length } : rest
}

// ─── Sending ─────────────────────────────────────────────────────────────────────────────────

export async function createBroadcast(
  input: BroadcastInput, adminId: bigint, ip: string | null,
): Promise<{ id: string; recipientCount: number; withDevice: number }> {
  if (input.category === 'offer' && !offersAllowedNow()) {
    throw httpError(422, 'Offers can only be sent between 10:00 and 21:00 IST', AppErrors.VALIDATION_ERROR.code)
  }
  const preview = await previewBroadcast(input.audience, input.category)
  if (preview.recipientCount === 0) {
    const why = preview.matched === 0
      ? 'No recipients match this audience'
      : 'Everyone this matches has switched this type off or already got today\'s limit of broadcasts'
    throw httpError(422, why, AppErrors.VALIDATION_ERROR.code)
  }

  const res = await pool.query<{ id: string }>(
    `INSERT INTO notification_broadcasts (admin_id, title, body, category, audience, recipient_count, skipped_opted_out, skipped_capped)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [adminId.toString(), input.title, input.body, input.category, JSON.stringify(input.audience), preview.recipientCount,
     preview.skippedOptedOut, preview.skippedCapped],
  )
  const id = res.rows[0]!.id

  await recordAuditLog({
    adminId, action: 'notification_broadcast', targetTable: 'notification_broadcasts', targetId: BigInt(id),
    afterState: {
      title: input.title, category: input.category, audience: maskAudience(input.audience),
      recipientCount: preview.recipientCount, withDevice: preview.withDevice,
      skippedOptedOut: preview.skippedOptedOut, skippedCapped: preview.skippedCapped,
    },
    ipAddress: ip,
  })
  const { pushQueue } = await import('@/jobs/queues')
  // Repeating a run is safe (see runBroadcast), so a crash or a stalled worker is retried instead of leaving people un-notified.
  // jobId: one job per broadcast, so it can never be queued twice.
  await pushQueue.add('broadcast_send', { broadcastId: id }, {
    jobId: `broadcast-${id}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 },
  })
  return { id, recipientCount: preview.recipientCount, withDevice: preview.withDevice }
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Runs in the push worker. Safe to run again after a failure: everyone already notified (a row for this broadcast and person) is
// skipped, and a unique index on (broadcast, person) means two overlapping runs can never notify the same person twice. Recipients are
// re-resolved at run time, so an opt-out made between "send" and the run is honoured.
export async function runBroadcast(broadcastId: string): Promise<number> {
  const row = (await pool.query<{ title: string; body: string; category: BroadcastInput['category']; audience: Audience; status: string }>(
    'SELECT title, body, category, audience, status FROM notification_broadcasts WHERE id = $1', [broadcastId],
  )).rows[0]
  if (!row || row.status === 'done') return 0

  await pool.query(
    `UPDATE notification_broadcasts SET status = 'sending', started_at = COALESCE(started_at, now()) WHERE id = $1 AND status <> 'done'`,
    [broadcastId],
  )
  const ownerType = row.audience.role === 'driver' ? 'driver' : 'user'
  let failed = 0
  try {
    const all = await resolveAudience(row.audience, row.category)
    const already = new Set((await pool.query<{ owner_id: string }>(
      `SELECT owner_id::text AS owner_id FROM notification_logs WHERE broadcast_id = $1 AND owner_type = $2`, [broadcastId, ownerType],
    )).rows.map((r) => r.owner_id))
    const todo = all.filter((id) => !already.has(id))

    for (let i = 0; i < todo.length; i += BROADCAST_CHUNK_SIZE) {
      if (i > 0 && BROADCAST_CHUNK_PAUSE_MS > 0) await pause(BROADCAST_CHUNK_PAUSE_MS)
      await Promise.all(todo.slice(i, i + BROADCAST_CHUNK_SIZE).map(async (id) => {
        try {
          await notifyOwner({ ownerType, ownerId: BigInt(id), type: row.category, title: row.title, body: row.body, broadcastId: BigInt(broadcastId) })
        } catch (err) {
          failed++
          log.warn({ err, broadcastId, ownerId: id }, 'broadcast: could not notify one recipient')
        }
      }))
    }
  } catch (err) {
    await pool.query(`UPDATE notification_broadcasts SET status = 'failed' WHERE id = $1`, [broadcastId]).catch(() => undefined)
    throw err
  }

  const done = await pool.query<{ sent: number }>(
    `UPDATE notification_broadcasts b
        SET status = 'done', finished_at = now(), failed_count = $2,
            sent_count = (SELECT count(*)::int FROM notification_logs l WHERE l.broadcast_id = b.id)
      WHERE b.id = $1 RETURNING b.sent_count AS sent`,
    [broadcastId, failed],
  )
  return done.rows[0]?.sent ?? 0
}

// ─── History ─────────────────────────────────────────────────────────────────────────────────

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().regex(/^\d{1,18}$/).optional(),
}).strict()

export type BroadcastSummary = {
  id: string
  title: string
  body: string
  category: BroadcastInput['category']
  audience: ReturnType<typeof maskAudience>
  status: 'queued' | 'sending' | 'done' | 'failed'
  sentBy: string | null
  createdAt: string
  finishedAt: string | null
  /** People notified (an in-app notification was created). */
  sent: number
  /** Of those: the push was accepted by Firebase for at least one phone. */
  pushed: number
  /** Firebase refused every phone (the phone was removed from our list if it was no longer valid). */
  pushFailed: number
  /** Notified in-app only: no registered phone, or the push result has not come back yet (see `settling`). */
  noPush: number
  /** Opened the notification in the app's notification list. Tapping the push itself is not counted yet. */
  opened: number
  /** Could not be notified at all (a database error), not counting people who were left out on purpose. */
  failed: number
  skippedOptedOut: number
  skippedCapped: number
  /** True while pushes are still being sent or results are still arriving (finished less than 2 minutes ago). */
  settling: boolean
}

export async function listBroadcasts(params: z.infer<typeof listQuerySchema>): Promise<{ broadcasts: BroadcastSummary[]; nextBefore: string | null }> {
  const res = await pool.query(
    `SELECT b.id::text AS id, b.title, b.body, b.category, b.audience, b.status, a.email AS sent_by, b.created_at, b.finished_at,
            b.sent_count, b.failed_count, b.skipped_opted_out, b.skipped_capped,
            (b.status <> 'done' OR b.finished_at > now() - interval '2 minutes') AS settling,
            s.pushed, s.push_failed, s.opened
       FROM notification_broadcasts b
       LEFT JOIN admins a ON a.id = b.admin_id
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE (l.provider_response->>'successCount')::int > 0)::int AS pushed,
                count(*) FILTER (WHERE (l.provider_response->>'successCount')::int = 0 AND (l.provider_response->>'failureCount')::int > 0)::int AS push_failed,
                count(*) FILTER (WHERE l.read_at IS NOT NULL)::int AS opened
           FROM notification_logs l WHERE l.broadcast_id = b.id
       ) s ON true
      WHERE ($1::bigint IS NULL OR b.id < $1::bigint)
      ORDER BY b.id DESC LIMIT $2`,
    [params.before ?? null, params.limit + 1],
  )
  const page = res.rows.slice(0, params.limit)
  const broadcasts: BroadcastSummary[] = page.map((r) => {
    const sent = r.sent_count as number
    const pushed = r.pushed as number
    const pushFailed = r.push_failed as number
    return {
      id: r.id as string,
      title: r.title as string,
      body: r.body as string,
      category: r.category as BroadcastSummary['category'],
      audience: maskAudience(r.audience as Audience),
      status: r.status as BroadcastSummary['status'],
      sentBy: (r.sent_by as string | null) ?? null,
      createdAt: new Date(r.created_at as string).toISOString(),
      finishedAt: r.finished_at ? new Date(r.finished_at as string).toISOString() : null,
      sent, pushed, pushFailed,
      noPush: Math.max(0, sent - pushed - pushFailed),
      opened: r.opened as number,
      failed: r.failed_count as number,
      skippedOptedOut: r.skipped_opted_out as number,
      skippedCapped: r.skipped_capped as number,
      settling: r.settling as boolean,
    }
  })
  return { broadcasts, nextBefore: res.rows.length > params.limit ? (page[page.length - 1]!.id as string) : null }
}
