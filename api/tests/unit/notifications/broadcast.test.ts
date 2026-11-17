import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.fn()
const queueAdd = vi.fn().mockResolvedValue(undefined)
const createRows = vi.fn()
const getTokens = vi.fn()
const record = vi.fn().mockResolvedValue(undefined)
const deleteTokens = vi.fn().mockResolvedValue(undefined)
const sendPush = vi.fn()
const audit = vi.fn().mockResolvedValue(undefined)
vi.mock('@/db/client', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }))
vi.mock('@/jobs/queues', () => ({ pushQueue: { add: (...a: unknown[]) => queueAdd(...a) } }))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: (...a: unknown[]) => audit(...a) }))
vi.mock('@/modules/notifications/notifications.repository', () => ({
  createBroadcastNotifications: (...a: unknown[]) => createRows(...a),
  getTokensForOwners: (...a: unknown[]) => getTokens(...a),
  recordBroadcastPushResults: (...a: unknown[]) => record(...a),
  deleteDeviceTokens: (...a: unknown[]) => deleteTokens(...a),
}))
vi.mock('@/modules/notifications/providers/push.provider', () => ({ sendPush: (...a: unknown[]) => sendPush(...a) }))
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
    expect(sql).toContain("broadcast_id IS NOT NULL AND created_at > now() - interval '24 hours'")
    expect(sql).toContain('GROUP BY owner_id') // counted once for everyone
    expect(sql).not.toMatch(/SELECT count\(\*\) FROM notification_logs l WHERE l\.owner_id = t\.id/) // not once per candidate
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
    expect(sql).not.toContain('broadcast_id')
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

  it('lists the typed phone numbers that match nobody, and names the people the others belong to', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ matched: 1, opted_out: 0, capped: 0, recipients: 1, with_device: 1 }] })
      .mockResolvedValueOnce({ rows: [{ phone: '+919861003979', name: 'Ashish Nayak', code: 'DRV000329' }] })
    const p = await previewBroadcast({ role: 'driver', phones: ['+919861003979', '+918000000000'] }, 'announcement')
    expect(p.phonesNotFound).toEqual(['+918000000000'])
    expect(p.people).toEqual([{ phone: '+919861003979', name: 'Ashish Nayak', code: 'DRV000329' }])
  })

  it('an audience without typed numbers looks nobody up', async () => {
    query.mockResolvedValueOnce({ rows: [{ matched: 5, opted_out: 0, capped: 0, recipients: 5, with_device: 5 }] })
    const p = await previewBroadcast(driverAll, 'announcement')
    expect(query).toHaveBeenCalledTimes(1)
    expect(p.people).toEqual([])
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
    expect(insertSql).toContain("'queued'") // the column default is 'done' (for the previous release), so this release says it explicitly
    expect(insertValues.slice(5)).toEqual([7, 1, 2])
    expect(queueAdd).toHaveBeenCalledWith('broadcast_send', { broadcastId: '9' }, expect.objectContaining({ jobId: 'broadcast-9', attempts: 3 }))
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'notification_broadcast', ipAddress: '1.2.3.4' }))
  })

  it('if the job cannot be queued the broadcast is marked failed (not left "Queued" forever) and the admin gets the error', async () => {
    query.mockResolvedValueOnce(counts({ matched: 3, recipients: 3, with_device: 3 })).mockResolvedValueOnce({ rows: [{ id: '4' }] }).mockResolvedValueOnce({ rows: [] })
    queueAdd.mockRejectedValueOnce(new Error('redis down'))
    await expect(createBroadcast(input, 1n, null)).rejects.toThrow('redis down')
    const failedUpdate = query.mock.calls.find(([sql]) => String(sql).includes("SET status = 'failed'")) as [string, unknown[]]
    expect(failedUpdate[1]).toEqual(['4'])
  })

  it('typed phone numbers never reach the audit log (the stored audience keeps them to resolve the send)', async () => {
    query.mockResolvedValueOnce(counts({ matched: 1, recipients: 1, with_device: 1 }))
      .mockResolvedValueOnce({ rows: [{ id: '3' }] })
    await createBroadcast({ ...input, audience: { role: 'driver', phones: ['+919861003979'] } }, 1n, null)
    expect(query).toHaveBeenCalledTimes(2) // one count and the insert: no second look-up of the same numbers
    expect(JSON.stringify(audit.mock.calls[0]![0].afterState)).not.toContain('9861003979')
    expect(audit.mock.calls[0]![0].afterState.audience).toEqual({ role: 'driver', phoneCount: 1 })
    expect(JSON.parse((query.mock.calls[1] as [string, unknown[]])[1][4] as string).phones).toEqual(['+919861003979'])
  })
})

describe('runBroadcast', () => {
  // Default world: every person has one phone called tok-<id>, their row is n<id>, and Firebase accepts everything.
  beforeEach(() => {
    vi.clearAllMocks()
    createRows.mockImplementation(async (p: { ownerIds: string[] }) => p.ownerIds.map((id) => ({ id: `n${id}`, ownerId: id })))
    getTokens.mockImplementation(async (_t: string, ids: string[]) => new Map(ids.map((id) => [id, [`tok-${id}`]])))
    sendPush.mockImplementation(async (tokens: string[]) => ({ invalidTokens: [], successCount: tokens.length, failureCount: 0, transientFailure: false, tokenResults: tokens.map(() => 'ok') }))
    record.mockResolvedValue(undefined)
    deleteTokens.mockResolvedValue(undefined)
  })
  type Row = { title: string; body: string; category: string; audience: Audience; status: string; recipient_count: number }
  const row = (over: Partial<Row> = {}): Row => ({ title: 'Hello', body: 'World', category: 'announcement', audience: { role: 'rider' }, status: 'queued', recipient_count: 0, ...over })

  // Answers each statement by what it does, so the tests do not depend on the order of the queries.
  function db(opts: { row?: Row | null; recipients?: string[]; already?: string[]; unsent?: string[]; sentCount?: number; resolveError?: Error }) {
    const calls: string[] = []
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT title, body, category, audience, status')) return { rows: opts.row === null ? [] : [opts.row ?? row()] }
      if (sql.includes("SET status = 'sending'")) { calls.push('sending'); return { rows: [] } }
      if (sql.includes('provider_response IS NULL AS unsent')) {
        const unsent = new Set(opts.unsent ?? [])
        return { rows: [...(opts.already ?? []), ...(opts.unsent ?? [])].map((owner_id) => ({ id: `n${owner_id}`, owner_id, unsent: unsent.has(owner_id) })) }
      }
      if (sql.includes("SET status = 'failed'")) { calls.push('failed'); return { rows: [] } }
      if (sql.includes('SET failed_count')) { calls.push('retry'); return { rows: [] } }
      if (sql.includes("SET status = 'done'")) { calls.push('done'); return { rows: [{ sent: opts.sentCount ?? 0 }] } }
      if (sql.includes('NOT c.opted_out AND NOT c.capped')) { if (opts.resolveError) throw opts.resolveError; return { rows: (opts.recipients ?? []).map((id) => ({ id })) } }
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`)
    })
    return calls
  }
  const doneArgs = () => (query.mock.calls.find(([sql]) => String(sql).includes("SET status = 'done'")) as [string, unknown[]])[1]
  const recorded = () => record.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>)

  it('creates the in-app rows for a group in one statement, pushes it in one call, and records every person\'s result', async () => {
    const calls = db({ recipients: ['1', '2'], sentCount: 2 })
    expect(await runBroadcast('9')).toBe(2)
    expect(createRows).toHaveBeenCalledTimes(1)
    expect(createRows).toHaveBeenCalledWith({ ownerType: 'user', ownerIds: ['1', '2'], type: 'announcement', title: 'Hello', body: 'World', broadcastId: 9n })
    expect(getTokens).toHaveBeenCalledTimes(1) // one look-up of everyone's phones
    expect(sendPush).toHaveBeenCalledTimes(1) // one Firebase call for the group
    expect(sendPush.mock.calls[0]![0]).toEqual(['tok-1', 'tok-2'])
    expect(recorded()).toEqual([
      { id: 'n1', attempted: true, successCount: 1, failureCount: 0, invalidTokens: 0 },
      { id: 'n2', attempted: true, successCount: 1, failureCount: 0, invalidTokens: 0 },
    ])
    expect(calls).toEqual(['sending', 'done'])
  })

  it('each phone gets its own notification id (so a tap can be tied to a person later), and the message uses the type\'s channel and lifetime', async () => {
    db({ recipients: ['1', '2'] })
    await runBroadcast('9')
    const [, msg, perToken] = sendPush.mock.calls[0]!
    expect(perToken).toEqual([{ notificationId: 'n1', type: 'announcement' }, { notificationId: 'n2', type: 'announcement' }])
    expect(msg).toMatchObject({ title: 'Hello', body: 'World', channelId: 'announcements_v1', ttlSeconds: 86400 })
  })

  it('an offer uses the offers channel', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at('06:30'))
    db({ row: row({ category: 'offer' }), recipients: ['1'] })
    await runBroadcast('9')
    expect(sendPush.mock.calls[0]![1]).toMatchObject({ channelId: 'offers_v1' })
    expect(createRows).toHaveBeenCalledWith(expect.objectContaining({ type: 'offer' }))
    vi.useRealTimers()
  })

  it('a broadcast that is already done does nothing at all', async () => {
    const calls = db({ row: row({ status: 'done' }), recipients: ['1'] })
    expect(await runBroadcast('9')).toBe(0)
    expect(createRows).not.toHaveBeenCalled()
    expect(sendPush).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('an unknown broadcast does nothing', async () => {
    db({ row: null })
    expect(await runBroadcast('9')).toBe(0)
    expect(createRows).not.toHaveBeenCalled()
  })

  it('a repeated run only creates rows for people not yet notified', async () => {
    db({ recipients: ['1', '2', '3'], already: ['1', '3'], sentCount: 3 })
    await runBroadcast('9')
    expect(createRows).toHaveBeenCalledTimes(1)
    expect(createRows.mock.calls[0]![0].ownerIds).toEqual(['2'])
  })

  it('a person whose row exists but whose push result never arrived (the run stopped between) is pushed now, without a second row', async () => {
    db({ recipients: ['1', '2'], already: ['2'], unsent: ['1'], sentCount: 2 })
    await runBroadcast('9')
    expect(createRows).not.toHaveBeenCalled()
    expect(sendPush.mock.calls.map((c) => c[0])).toEqual([['tok-1']])
    expect(recorded()).toEqual([{ id: 'n1', attempted: true, successCount: 1, failureCount: 0, invalidTokens: 0 }])
  })

  it('drivers are notified as drivers', async () => {
    db({ row: row({ audience: { role: 'driver' } }), recipients: ['5'] })
    await runBroadcast('9')
    expect(createRows).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'driver', ownerIds: ['5'] }))
    expect(getTokens).toHaveBeenCalledWith('driver', ['5'])
  })

  it('works through groups of 500: 1,200 people are 3 statements and 3 Firebase calls, never one call per person', async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => String(i + 1))
    db({ recipients: ids, sentCount: 1200 })
    await runBroadcast('9')
    expect(createRows.mock.calls.map((c) => c[0].ownerIds.length)).toEqual([500, 500, 200])
    expect(sendPush.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([500, 500, 200])
    expect(getTokens).toHaveBeenCalledTimes(3)
    expect(record).toHaveBeenCalledTimes(3)
  })

  it('a person with no registered phone still gets the in-app row, is recorded as not pushed, and costs no Firebase call', async () => {
    getTokens.mockResolvedValue(new Map())
    db({ recipients: ['1', '2'] })
    await runBroadcast('9')
    expect(sendPush).not.toHaveBeenCalled()
    expect(recorded()).toEqual([
      { id: 'n1', attempted: false, successCount: 0, failureCount: 0, invalidTokens: 0 },
      { id: 'n2', attempted: false, successCount: 0, failureCount: 0, invalidTokens: 0 },
    ])
  })

  it('a person with two phones gets one push per phone, counted once for them', async () => {
    getTokens.mockResolvedValue(new Map([['1', ['tok-a', 'tok-b']]]))
    db({ recipients: ['1'] })
    await runBroadcast('9')
    expect(sendPush.mock.calls[0]![0]).toEqual(['tok-a', 'tok-b'])
    expect(recorded()).toEqual([{ id: 'n1', attempted: true, successCount: 2, failureCount: 0, invalidTokens: 0 }])
  })

  it('a group holding more than 500 phones (people with several phones) is sent in calls of at most 500', async () => {
    getTokens.mockResolvedValue(new Map([['1', Array.from({ length: 700 }, (_, i) => `tok-${i}`)]]))
    db({ recipients: ['1'] })
    await runBroadcast('9')
    expect(sendPush.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([500, 200])
    expect(recorded()).toEqual([{ id: 'n1', attempted: true, successCount: 700, failureCount: 0, invalidTokens: 0 }])
  })

  it('a dead phone is counted for that person and removed from our list; the others are unaffected', async () => {
    sendPush.mockResolvedValue({ invalidTokens: ['tok-2'], successCount: 1, failureCount: 1, transientFailure: false, tokenResults: ['ok', 'invalid'] })
    db({ recipients: ['1', '2'] })
    await runBroadcast('9')
    expect(recorded()).toEqual([
      { id: 'n1', attempted: true, successCount: 1, failureCount: 0, invalidTokens: 0 },
      { id: 'n2', attempted: true, successCount: 0, failureCount: 1, invalidTokens: 1 },
    ])
    expect(deleteTokens).toHaveBeenCalledWith(['tok-2'])
  })

  it('trouble that a retry can fix is retried for just those phones, and the person then counts as pushed', async () => {
    vi.useFakeTimers()
    sendPush
      .mockResolvedValueOnce({ invalidTokens: [], successCount: 1, failureCount: 1, transientFailure: true, tokenResults: ['ok', 'retry'] })
      .mockResolvedValueOnce({ invalidTokens: [], successCount: 1, failureCount: 0, transientFailure: false, tokenResults: ['ok'] })
    db({ recipients: ['1', '2'] })
    const run = runBroadcast('9')
    await vi.advanceTimersByTimeAsync(5000)
    await run
    expect(sendPush.mock.calls.map((c) => c[0])).toEqual([['tok-1', 'tok-2'], ['tok-2']])
    expect(recorded()).toEqual([
      { id: 'n1', attempted: true, successCount: 1, failureCount: 0, invalidTokens: 0 },
      { id: 'n2', attempted: true, successCount: 1, failureCount: 0, invalidTokens: 0 },
    ])
    vi.useRealTimers()
  })

  it('Firebase down for every attempt: tried 3 times, then recorded as failed with a reason, and the broadcast still completes', async () => {
    vi.useFakeTimers()
    sendPush.mockImplementation(async (tokens: string[]) => ({ invalidTokens: [], successCount: 0, failureCount: tokens.length, transientFailure: true, tokenResults: tokens.map(() => 'retry') }))
    const calls = db({ recipients: ['1'] })
    const run = runBroadcast('9')
    await vi.advanceTimersByTimeAsync(20_000)
    await run
    expect(sendPush).toHaveBeenCalledTimes(3)
    expect(recorded()).toEqual([{ id: 'n1', attempted: true, successCount: 0, failureCount: 1, invalidTokens: 0, failureReason: 'fcm_unavailable' }])
    expect(calls).toEqual(['sending', 'done'])
    vi.useRealTimers()
  })

  it('push not configured here (no per-phone answer): nothing is retried and nothing is counted', async () => {
    sendPush.mockResolvedValue({ invalidTokens: [], successCount: 0, failureCount: 0, transientFailure: false })
    db({ recipients: ['1'] })
    await runBroadcast('9')
    expect(sendPush).toHaveBeenCalledTimes(1)
    expect(recorded()).toEqual([{ id: 'n1', attempted: true, successCount: 0, failureCount: 0, invalidTokens: 0 }])
  })

  it('a group that cannot be written does not stop the next one, and its people are counted as failed', async () => {
    const ids = Array.from({ length: 600 }, (_, i) => String(i + 1))
    createRows.mockRejectedValueOnce(new Error('db blip'))
    db({ recipients: ids, sentCount: 100 })
    await runBroadcast('9') // final attempt by default: completes
    expect(createRows).toHaveBeenCalledTimes(2)
    expect(doneArgs()[1]).toBe(500)
  })

  it('failed groups make a non-final attempt throw, so the queue retries exactly them', async () => {
    createRows.mockRejectedValueOnce(new Error('db blip'))
    const calls = db({ recipients: ['1', '2'] })
    await expect(runBroadcast('9', false)).rejects.toThrow('could not be notified')
    expect(calls).toEqual(['sending', 'retry']) // recorded, but not marked done
  })

  it('a push that throws unexpectedly fails only its group', async () => {
    sendPush.mockRejectedValueOnce(new Error('boom'))
    db({ recipients: ['1', '2'] })
    await runBroadcast('9')
    expect(doneArgs()[1]).toBe(2)
  })

  it('records who was promised but dropped between the check and the send', async () => {
    db({ row: row({ recipient_count: 5 }), recipients: ['1', '2'], sentCount: 2 })
    await runBroadcast('9')
    expect(doneArgs()).toEqual(['9', 0, 3])
  })

  it('people notified by an earlier pass are not counted as dropped', async () => {
    db({ row: row({ recipient_count: 2 }), recipients: ['2'], already: ['1'], sentCount: 2 })
    await runBroadcast('9')
    expect(doneArgs()).toEqual(['9', 0, 0])
  })

  it('nobody dropped means zero, never a negative number', async () => {
    db({ row: row({ recipient_count: 1 }), recipients: ['1', '2'], sentCount: 2 })
    await runBroadcast('9')
    expect(doneArgs()[2]).toBe(0)
  })

  it('an offer whose allowed hours passed before a retry ran is not sent', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at('16:30')) // 22:00 IST
    const calls = db({ row: row({ category: 'offer' }), recipients: ['1'] })
    expect(await runBroadcast('9')).toBe(0)
    expect(createRows).not.toHaveBeenCalled()
    expect(calls).toEqual(['failed'])
    vi.useRealTimers()
  })

  it('a recipient list that cannot be read marks the broadcast failed and lets the queue retry it', async () => {
    const calls = db({ recipients: [], resolveError: new Error('db down') })
    await expect(runBroadcast('9')).rejects.toThrow('db down')
    expect(calls).toEqual(['sending', 'failed'])
  })
})

describe('listBroadcasts', () => {
  beforeEach(() => vi.clearAllMocks())
  const dbRow = (over: Record<string, unknown> = {}) => ({
    id: '7', title: 'T', body: 'B', category: 'announcement', audience: { role: 'driver', docIssues: true }, status: 'done', sent_by: 'ops@ocar.app',
    created_at: '2026-11-17T06:41:04.000Z', finished_at: '2026-11-17T06:41:06.000Z', sent_count: 100, failed_count: 1,
    skipped_opted_out: 4, skipped_capped: 2, skipped_at_send: 0, recipient_count: 100, settling: false, pushed: 60, push_failed: 10, opened: 5, ...over,
  })

  it('maps the counts and works out how many got the in-app notification only', async () => {
    query.mockResolvedValueOnce({ rows: [dbRow()] })
    const { broadcasts, nextBefore } = await listBroadcasts({ limit: 20 })
    expect(broadcasts[0]).toMatchObject({ id: '7', sent: 100, pushed: 60, pushFailed: 10, noPush: 30, opened: 5, failed: 1, skippedOptedOut: 4, skippedCapped: 2, sentBy: 'ops@ocar.app', status: 'done', settling: false })
    expect(nextBefore).toBeNull()
  })

  it('"settling" is only for a broadcast still going or just finished: a failed or long-stuck one must not keep the page polling', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await listBroadcasts({ limit: 20 })
    const sql = String(query.mock.calls[0]![0])
    expect(sql).toContain("b.status IN ('queued', 'sending') AND b.created_at > now() - interval '30 minutes'")
    expect(sql).toContain("b.status = 'done' AND b.finished_at > now() - interval '2 minutes'")
    expect(sql).not.toMatch(/b\.status <> 'done'/)
  })

  it('never lets a negative "no push" appear if the counts overlap', async () => {
    query.mockResolvedValueOnce({ rows: [dbRow({ sent_count: 10, pushed: 8, push_failed: 5 })] })
    expect((await listBroadcasts({ limit: 20 })).broadcasts[0]!.noPush).toBe(0)
  })

  it('a tracked broadcast reports its own counts', async () => {
    query.mockResolvedValueOnce({ rows: [dbRow({ skipped_at_send: 3, recipient_count: 120 })] })
    expect((await listBroadcasts({ limit: 20 })).broadcasts[0]).toMatchObject({ tracked: true, sent: 100, skippedAtSend: 3 })
  })

  it('a send made by the previous release (done, never finished_at) is marked untracked and shows the promised count, not zeros', async () => {
    query.mockResolvedValueOnce({ rows: [dbRow({ finished_at: null, sent_count: 0, recipient_count: 578, pushed: 0, push_failed: 0, settling: false })] })
    const b = (await listBroadcasts({ limit: 20 })).broadcasts[0]!
    expect(b).toMatchObject({ tracked: false, sent: 578, pushed: 0, pushFailed: 0, noPush: 0, status: 'done', settling: false, finishedAt: null })
  })

  it('a failed or queued broadcast without finished_at is still tracked (it has its own counts)', async () => {
    query.mockResolvedValueOnce({ rows: [dbRow({ status: 'failed', finished_at: null, sent_count: 0, recipient_count: 50 })] })
    expect((await listBroadcasts({ limit: 20 })).broadcasts[0]).toMatchObject({ tracked: true, sent: 0 })
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
