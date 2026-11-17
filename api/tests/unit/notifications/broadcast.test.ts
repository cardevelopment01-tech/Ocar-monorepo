import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.fn()
const queueAdd = vi.fn().mockResolvedValue(undefined)
const notifyOwner = vi.fn().mockResolvedValue(undefined)
const audit = vi.fn().mockResolvedValue(undefined)
vi.mock('@/db/client', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }))
vi.mock('@/jobs/queues', () => ({ pushQueue: { add: (...a: unknown[]) => queueAdd(...a) } }))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: (...a: unknown[]) => audit(...a) }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyOwner: (...a: unknown[]) => notifyOwner(...a) }))
vi.mock('@/modules/drivers/drivers.repository', () => ({ docIssueExistsSql: (id: string) => `DOC_GATE(${id})` }))

import {
  audienceSchema, broadcastSchema, createBroadcast, listBroadcasts, maskAudience, normalizeIndianPhone, offersAllowedNow,
  previewBroadcast, resolveAudience, runBroadcast, type Audience,
} from '@/modules/notifications/broadcast.service'

// Value: protects=an admin broadcast reaches exactly the people the audience filters say (and never someone who switched the type off or
// already got today's limit), the preview tells the truth about it, a run can be repeated without notifying anyone twice, and the history
// reports what happened; fails_when=a filter is dropped from the query, the daily limit is skipped, typed phone numbers leak into the
// audit log or the history, or a repeated run notifies people again; why_new=broadcasts had no filters, no limit, no history and could not
// be safely retried; seam=pool.query and notifyOwner are replaced (the SQL is asserted as text); no_claim=that the SQL returns the right
// rows on a real database (tests/integration/broadcast-v2.test.ts does that).

// 12:00 IST = 06:30 UTC; 22:00 IST = 16:30 UTC; 09:59 IST = 04:29 UTC
const at = (utc: string) => new Date(`2026-10-13T${utc}:00Z`)
const driverAll: Audience = { role: 'driver' }

describe('offersAllowedNow', () => {
  it('allows 10:00-20:59 IST only', () => {
    expect(offersAllowedNow(at('06:30'))).toBe(true)
    expect(offersAllowedNow(at('04:30'))).toBe(true)
    expect(offersAllowedNow(at('04:29'))).toBe(false)
    expect(offersAllowedNow(at('15:30'))).toBe(false)
    expect(offersAllowedNow(at('16:30'))).toBe(false)
  })
})

describe('normalizeIndianPhone', () => {
  it('accepts the usual ways of writing a mobile number', () => {
    for (const p of ['9861003979', '98610 03979', '+919861003979', '919861003979', '+91 98610-03979']) expect(normalizeIndianPhone(p)).toBe('+919861003979')
  })
  it('rejects anything that is not an Indian mobile number', () => {
    for (const p of ['', '12345', '5861003979', '+14155550123', '98610039799', 'abc']) expect(normalizeIndianPhone(p)).toBeNull()
  })
})

describe('broadcastSchema', () => {
  const ok = { title: 'T', body: 'B', category: 'announcement', audience: { role: 'driver' } }
  it('accepts a valid broadcast', () => expect(broadcastSchema.safeParse(ok).success).toBe(true))
  it('rejects empty or oversized text and unknown fields', () => {
    expect(broadcastSchema.safeParse({ ...ok, title: ' ' }).success).toBe(false)
    expect(broadcastSchema.safeParse({ ...ok, body: 'x'.repeat(301) }).success).toBe(false)
    expect(broadcastSchema.safeParse({ ...ok, audience: { role: 'driver', sql: '1=1' } }).success).toBe(false)
  })
  it('accepts every driver filter together, and the rider booking filter', () => {
    expect(audienceSchema.safeParse({ role: 'driver', missingRcBack: true, docIssues: true, cityIds: [1, 2], categoryIds: [3] }).success).toBe(true)
    expect(audienceSchema.safeParse({ role: 'rider', bookedInLastDays: 30 }).success).toBe(true)
  })
  it('keeps driver filters off riders and the booking filter off drivers', () => {
    expect(audienceSchema.safeParse({ role: 'rider', cityIds: [1] }).success).toBe(false)
    expect(audienceSchema.safeParse({ role: 'rider', docIssues: true }).success).toBe(false)
    expect(audienceSchema.safeParse({ role: 'driver', bookedInLastDays: 7 }).success).toBe(false)
  })
  it('bounds the id lists and the booking window', () => {
    expect(audienceSchema.safeParse({ role: 'driver', cityIds: [] }).success).toBe(false)
    expect(audienceSchema.safeParse({ role: 'driver', cityIds: Array.from({ length: 101 }, (_, i) => i + 1) }).success).toBe(false)
    expect(audienceSchema.safeParse({ role: 'driver', cityIds: [0] }).success).toBe(false)
    expect(audienceSchema.safeParse({ role: 'rider', bookedInLastDays: 0 }).success).toBe(false)
    expect(audienceSchema.safeParse({ role: 'rider', bookedInLastDays: 366 }).success).toBe(false)
  })
  it('phone numbers are normalised, limited to 10, and cannot be mixed with other filters', () => {
    const r = audienceSchema.safeParse({ role: 'driver', phones: ['98610 03979', '+918093630642'] })
    expect(r.success && r.data.phones).toEqual(['+919861003979', '+918093630642'])
    expect(audienceSchema.safeParse({ role: 'driver', phones: ['123'] }).success).toBe(false)
    expect(audienceSchema.safeParse({ role: 'driver', phones: Array.from({ length: 11 }, () => '9861003979') }).success).toBe(false)
    expect(audienceSchema.safeParse({ role: 'driver', phones: ['9861003979'], docIssues: true }).success).toBe(false)
    expect(audienceSchema.safeParse({ role: 'rider', phones: ['9861003979'], bookedInLastDays: 7 }).success).toBe(false)
  })
})

describe('the audience query', () => {
  beforeEach(() => { vi.clearAllMocks(); query.mockResolvedValue({ rows: [] }) })
  const lastQuery = () => query.mock.calls[query.mock.calls.length - 1] as [string, unknown[]]

  it('drivers: only active ones, minus anyone who switched the type off or hit the daily limit', async () => {
    await resolveAudience(driverAll, 'announcement')
    const [sql, values] = lastQuery()
    expect(sql).toContain("t.status = 'active'")
    expect(sql).toContain('FROM drivers t')
    expect(sql).toContain('NOT p.push_enabled')
    expect(sql).toContain('NOT c.opted_out AND NOT c.capped')
    expect(sql).toContain("l.broadcast_id IS NOT NULL AND l.created_at > now() - interval '24 hours'")
    expect(values.slice(0, 2)).toEqual(['driver', 'announcements'])
    expect(values).toContain(2) // the daily limit is a bound value, not text in the SQL
  })

  it('riders use the users table and the offers preference for an offer', async () => {
    await resolveAudience({ role: 'rider' }, 'offer')
    const [sql, values] = lastQuery()
    expect(sql).toContain('FROM users t')
    expect(values.slice(0, 2)).toEqual(['user', 'offers'])
  })

  it('every driver filter is in the query, as bound values where it carries any', async () => {
    await resolveAudience({ role: 'driver', missingRcBack: true, docIssues: true, cityIds: [1, 2], categoryIds: [4] }, 'announcement')
    const [sql, values] = lastQuery()
    expect(sql).toContain("x.doc_type = 'vehicle_rc_back'")
    expect(sql).toContain('DOC_GATE(t.id)')
    expect(sql).toContain('t.city_id = ANY(')
    expect(sql).toContain('v.category_id = ANY(')
    expect(values).toContainEqual([1, 2])
    expect(values).toContainEqual([4])
  })

  it('riders: the booking window is a bound value', async () => {
    await resolveAudience({ role: 'rider', bookedInLastDays: 30 }, 'announcement')
    const [sql, values] = lastQuery()
    expect(sql).toContain('r.requested_at > now() - make_interval(days =>')
    expect(values).toContain(30)
  })

  it('phone numbers match by phone and are exempt from the daily limit (a test must always go through)', async () => {
    await resolveAudience({ role: 'driver', phones: ['+919861003979'] }, 'announcement')
    const [sql, values] = lastQuery()
    expect(sql).toContain('t.phone = ANY(')
    expect(sql).toContain('false AS capped')
    expect(sql).not.toContain('l.broadcast_id')
    expect(values).toContainEqual(['+919861003979'])
    expect(values).not.toContain(2)
  })

  it('no user input ever lands in the SQL text', async () => {
    await resolveAudience({ role: 'driver', phones: ["+919861003979'; DROP TABLE drivers;--"] } as Audience, 'announcement')
    expect(lastQuery()[0]).not.toContain('DROP TABLE')
  })
})

describe('previewBroadcast', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('says who will be notified, who also gets the push, and who was left out and why', async () => {
    query.mockResolvedValueOnce({ rows: [{ matched: 100, opted_out: 10, capped: 5, recipients: 85, with_device: 60 }] })
    const p = await previewBroadcast(driverAll, 'announcement')
    expect(p).toMatchObject({ matched: 100, recipientCount: 85, withDevice: 60, inAppOnly: 25, skippedOptedOut: 10, skippedCapped: 5, dailyCap: 2, sendableNow: true, phonesNotFound: [] })
  })

  it('an offer outside 10:00-21:00 IST is not sendable now', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at('16:30'))
    query.mockResolvedValueOnce({ rows: [{ matched: 1, opted_out: 0, capped: 0, recipients: 1, with_device: 1 }] })
    expect((await previewBroadcast(driverAll, 'offer')).sendableNow).toBe(false)
    vi.useRealTimers()
  })

  it('lists the typed phone numbers that match nobody', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ matched: 1, opted_out: 0, capped: 0, recipients: 1, with_device: 1 }] })
      .mockResolvedValueOnce({ rows: [{ phone: '+919861003979' }] })
    const p = await previewBroadcast({ role: 'driver', phones: ['+919861003979', '+918000000000'] }, 'announcement')
    expect(p.phonesNotFound).toEqual(['+918000000000'])
  })
})

describe('createBroadcast', () => {
  beforeEach(() => { vi.clearAllMocks(); queueAdd.mockResolvedValue(undefined) })
  const input = { title: 'T', body: 'B', category: 'announcement' as const, audience: { role: 'driver' as const, missingRcBack: true } }
  const counts = (c: Partial<{ matched: number; opted_out: number; capped: number; recipients: number; with_device: number }>) =>
    ({ rows: [{ matched: 0, opted_out: 0, capped: 0, recipients: 0, with_device: 0, ...c }] })

  it('refuses an empty audience instead of sending to nobody', async () => {
    query.mockResolvedValueOnce(counts({}))
    await expect(createBroadcast(input, 1n, null)).rejects.toMatchObject({ httpStatus: 422, message: 'No recipients match this audience' })
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('says so when everyone it matches was left out by opt-outs or the daily limit', async () => {
    query.mockResolvedValueOnce(counts({ matched: 4, opted_out: 1, capped: 3 }))
    await expect(createBroadcast(input, 1n, null)).rejects.toMatchObject({ httpStatus: 422, message: expect.stringContaining("today's limit") })
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('refuses an offer outside 10:00-21:00 IST before touching the database', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at('16:30'))
    await expect(createBroadcast({ ...input, category: 'offer' }, 1n, null)).rejects.toMatchObject({ httpStatus: 422 })
    expect(query).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('stores the broadcast with the counts it left out, audits it, and queues one job that is safe to retry', async () => {
    query.mockResolvedValueOnce(counts({ matched: 10, opted_out: 1, capped: 2, recipients: 7, with_device: 5 })).mockResolvedValueOnce({ rows: [{ id: '9' }] })
    expect(await createBroadcast(input, 1n, '1.2.3.4')).toEqual({ id: '9', recipientCount: 7, withDevice: 5 })
    const [insertSql, insertValues] = query.mock.calls[1] as [string, unknown[]]
    expect(insertSql).toContain('INSERT INTO notification_broadcasts')
    expect(insertValues.slice(5)).toEqual([7, 1, 2])
    expect(queueAdd).toHaveBeenCalledWith('broadcast_send', { broadcastId: '9' }, expect.objectContaining({ jobId: 'broadcast-9', attempts: 3 }))
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'notification_broadcast', ipAddress: '1.2.3.4' }))
  })

  it('typed phone numbers never reach the audit log (the stored audience keeps them to resolve the send)', async () => {
    query.mockResolvedValueOnce(counts({ matched: 1, recipients: 1, with_device: 1 }))
      .mockResolvedValueOnce({ rows: [{ phone: '+919861003979' }] })
      .mockResolvedValueOnce({ rows: [{ id: '3' }] })
    await createBroadcast({ ...input, audience: { role: 'driver', phones: ['+919861003979'] } }, 1n, null)
    expect(JSON.stringify(audit.mock.calls[0]![0].afterState)).not.toContain('9861003979')
    expect(audit.mock.calls[0]![0].afterState.audience).toEqual({ role: 'driver', phoneCount: 1 })
    expect(JSON.parse((query.mock.calls[2] as [string, unknown[]])[1][4] as string).phones).toEqual(['+919861003979'])
  })
})

describe('runBroadcast', () => {
  beforeEach(() => { vi.clearAllMocks(); notifyOwner.mockResolvedValue(undefined) })
  type Row = { title: string; body: string; category: string; audience: Audience; status: string }
  const row = (over: Partial<Row> = {}): Row => ({ title: 'Hello', body: 'World', category: 'offer', audience: { role: 'rider' }, status: 'queued', ...over })

  // Answers each statement by what it does, so the tests do not depend on the order of the queries.
  function db(opts: { row?: Row | null; recipients?: string[]; already?: string[]; sentCount?: number; resolveError?: Error }) {
    const calls: string[] = []
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT title, body, category, audience, status')) return { rows: opts.row === null ? [] : [opts.row ?? row()] }
      if (sql.includes("SET status = 'sending'")) { calls.push('sending'); return { rows: [] } }
      if (sql.includes('FROM notification_logs WHERE broadcast_id')) return { rows: (opts.already ?? []).map((owner_id) => ({ owner_id })) }
      if (sql.includes("SET status = 'failed'")) { calls.push('failed'); return { rows: [] } }
      if (sql.includes("SET status = 'done'")) { calls.push('done'); return { rows: [{ sent: opts.sentCount ?? 0 }] } }
      if (sql.includes('NOT c.opted_out AND NOT c.capped')) { if (opts.resolveError) throw opts.resolveError; return { rows: (opts.recipients ?? []).map((id) => ({ id })) } }
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`)
    })
    return calls
  }

  it('notifies every resolved recipient with the stored text, the category as the type, and the broadcast id', async () => {
    const calls = db({ recipients: ['1', '2'], sentCount: 2 })
    expect(await runBroadcast('9')).toBe(2)
    expect(notifyOwner).toHaveBeenCalledTimes(2)
    expect(notifyOwner).toHaveBeenCalledWith({ ownerType: 'user', ownerId: 1n, type: 'offer', title: 'Hello', body: 'World', broadcastId: 9n })
    expect(calls).toEqual(['sending', 'done'])
  })

  it('a broadcast that is already done does nothing at all', async () => {
    const calls = db({ row: row({ status: 'done' }), recipients: ['1'] })
    expect(await runBroadcast('9')).toBe(0)
    expect(notifyOwner).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('an unknown broadcast does nothing', async () => {
    db({ row: null })
    expect(await runBroadcast('9')).toBe(0)
    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('a repeated run skips everyone already notified for this broadcast', async () => {
    db({ recipients: ['1', '2', '3'], already: ['1', '3'], sentCount: 3 })
    await runBroadcast('9')
    expect(notifyOwner).toHaveBeenCalledTimes(1)
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 2n }))
  })

  it('drivers are notified as drivers', async () => {
    db({ row: row({ audience: { role: 'driver' } }), recipients: ['5'] })
    await runBroadcast('9')
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'driver', ownerId: 5n }))
  })

  it('one failing recipient does not stop the rest, and is counted', async () => {
    db({ recipients: ['1', '2'] })
    notifyOwner.mockRejectedValueOnce(new Error('boom'))
    await runBroadcast('9')
    expect(notifyOwner).toHaveBeenCalledTimes(2)
    const doneCall = query.mock.calls.find(([sql]) => String(sql).includes("SET status = 'done'")) as [string, unknown[]]
    expect(doneCall[1]).toEqual(['9', 1])
  })

  it('a recipient list that cannot be read marks the broadcast failed and lets the queue retry it', async () => {
    const calls = db({ recipients: [], resolveError: new Error('db down') })
    await expect(runBroadcast('9')).rejects.toThrow('db down')
    expect(calls).toEqual(['sending', 'failed'])
  })

  it('works through more than one group of recipients', async () => {
    const ids = Array.from({ length: 45 }, (_, i) => String(i + 1))
    db({ recipients: ids, sentCount: 45 })
    await runBroadcast('9')
    expect(notifyOwner).toHaveBeenCalledTimes(45)
  })
})

describe('listBroadcasts', () => {
  beforeEach(() => vi.clearAllMocks())
  const dbRow = (over: Record<string, unknown> = {}) => ({
    id: '7', title: 'T', body: 'B', category: 'announcement', audience: { role: 'driver', docIssues: true }, status: 'done', sent_by: 'ops@ocar.app',
    created_at: '2026-11-17T06:41:04.000Z', finished_at: '2026-11-17T06:41:06.000Z', sent_count: 100, failed_count: 1,
    skipped_opted_out: 4, skipped_capped: 2, settling: false, pushed: 60, push_failed: 10, opened: 5, ...over,
  })

  it('maps the counts and works out how many got the in-app notification only', async () => {
    query.mockResolvedValueOnce({ rows: [dbRow()] })
    const { broadcasts, nextBefore } = await listBroadcasts({ limit: 20 })
    expect(broadcasts[0]).toMatchObject({ id: '7', sent: 100, pushed: 60, pushFailed: 10, noPush: 30, opened: 5, failed: 1, skippedOptedOut: 4, skippedCapped: 2, sentBy: 'ops@ocar.app', status: 'done', settling: false })
    expect(nextBefore).toBeNull()
  })

  it('never lets a negative "no push" appear if the counts overlap', async () => {
    query.mockResolvedValueOnce({ rows: [dbRow({ sent_count: 10, pushed: 8, push_failed: 5 })] })
    expect((await listBroadcasts({ limit: 20 })).broadcasts[0]!.noPush).toBe(0)
  })

  it('hides typed phone numbers and shows how many there were', async () => {
    query.mockResolvedValueOnce({ rows: [dbRow({ audience: { role: 'driver', phones: ['+919861003979', '+918093630642'] } })] })
    const a = (await listBroadcasts({ limit: 20 })).broadcasts[0]!.audience
    expect(a).toEqual({ role: 'driver', phoneCount: 2 })
    expect(JSON.stringify(a)).not.toContain('9861003979')
  })

  it('pages: asks for one extra row and returns the id to continue from', async () => {
    query.mockResolvedValueOnce({ rows: [dbRow({ id: '9' }), dbRow({ id: '8' }), dbRow({ id: '7' })] })
    const out = await listBroadcasts({ limit: 2, before: '12' })
    expect(out.broadcasts.map((b) => b.id)).toEqual(['9', '8'])
    expect(out.nextBefore).toBe('8')
    expect(query.mock.calls[0]![1]).toEqual(['12', 3])
  })
})

describe('maskAudience', () => {
  it('replaces phone numbers with a count and leaves every other audience untouched', () => {
    expect(maskAudience({ role: 'driver', phones: ['+919861003979'] })).toEqual({ role: 'driver', phoneCount: 1 })
    expect(maskAudience({ role: 'driver', cityIds: [1] })).toEqual({ role: 'driver', cityIds: [1] })
  })
})
