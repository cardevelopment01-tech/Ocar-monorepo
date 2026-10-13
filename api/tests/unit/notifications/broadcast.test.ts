import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.fn()
const queueAdd = vi.fn().mockResolvedValue(undefined)
const notifyOwner = vi.fn().mockResolvedValue(undefined)
vi.mock('@/db/client', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }))
vi.mock('@/jobs/queues', () => ({ pushQueue: { add: (...a: unknown[]) => queueAdd(...a) } }))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyOwner: (...a: unknown[]) => notifyOwner(...a) }))

import { broadcastSchema, createBroadcast, offersAllowedNow, runBroadcast } from '@/modules/notifications/broadcast.service'

// 12:00 IST = 06:30 UTC; 22:00 IST = 16:30 UTC; 09:59 IST = 04:29 UTC
const at = (utc: string) => new Date(`2026-10-13T${utc}:00Z`)

describe('offersAllowedNow', () => {
  it('allows 10:00-20:59 IST only', () => {
    expect(offersAllowedNow(at('06:30'))).toBe(true)
    expect(offersAllowedNow(at('04:30'))).toBe(true)
    expect(offersAllowedNow(at('04:29'))).toBe(false)
    expect(offersAllowedNow(at('15:30'))).toBe(false)
    expect(offersAllowedNow(at('16:30'))).toBe(false)
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
})

describe('createBroadcast', () => {
  beforeEach(() => { vi.clearAllMocks(); queueAdd.mockResolvedValue(undefined) })
  const input = { title: 'T', body: 'B', category: 'announcement' as const, audience: { role: 'driver' as const, missingRcBack: true } }

  it('refuses an empty audience instead of sending to nobody', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(createBroadcast(input, 1n, null)).rejects.toMatchObject({ httpStatus: 422 })
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('stores the broadcast, then queues one send job', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: '5' }, { id: '6' }] }).mockResolvedValueOnce({ rows: [{ id: '9' }] })
    expect(await createBroadcast(input, 1n, '1.2.3.4')).toEqual({ id: '9', recipientCount: 2 })
    expect(queueAdd).toHaveBeenCalledWith('broadcast_send', { broadcastId: '9' }, { attempts: 1 })
  })

  it('the RC-back filter and the opt-out check are in the audience query', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: '5' }] }).mockResolvedValueOnce({ rows: [{ id: '9' }] })
    await createBroadcast(input, 1n, null)
    const [sql, values] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain("x.doc_type = 'vehicle_rc_back'")
    expect(sql).toContain('NOT p.push_enabled')
    expect(values).toEqual(['driver', 'announcements'])
  })
})

describe('runBroadcast', () => {
  beforeEach(() => vi.clearAllMocks())

  it('notifies every resolved recipient with the stored text and category as the type', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ title: 'Hello', body: 'World', category: 'offer', audience: { role: 'rider' } }] })
      .mockResolvedValueOnce({ rows: [{ id: '1' }, { id: '2' }] })
    expect(await runBroadcast('9')).toBe(2)
    expect(notifyOwner).toHaveBeenCalledTimes(2)
    expect(notifyOwner).toHaveBeenCalledWith({ ownerType: 'user', ownerId: 1n, type: 'offer', title: 'Hello', body: 'World' })
  })

  it('one failing recipient does not stop the rest', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ title: 'T', body: 'B', category: 'announcement', audience: { role: 'driver' } }] })
      .mockResolvedValueOnce({ rows: [{ id: '1' }, { id: '2' }] })
    notifyOwner.mockRejectedValueOnce(new Error('boom'))
    expect(await runBroadcast('9')).toBe(2)
    expect(notifyOwner).toHaveBeenCalledTimes(2)
  })
})
