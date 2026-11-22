import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }))
vi.mock('@/db/redis', () => ({
  getJSON: vi.fn(), setWithTTL: vi.fn(), withTimeout: vi.fn(async (p: Promise<unknown>) => p),
  client: { incr: vi.fn(), del: vi.fn(), get: vi.fn() },
}))

import { getDispatchSummary, listDispatchQueue } from '@/modules/admin/dispatch.repository'
import { parseQueueQuery } from '@/modules/admin/dispatch'

const sqls = () => poolQuery.mock.calls.map((c) => String(c[0]))
beforeEach(() => { vi.clearAllMocks(); poolQuery.mockResolvedValue({ rows: [{ n: 0 }] }) })

describe('parseQueueQuery', () => {
  it('defaults to the scheduled lane, page 1, 25 rows', () => {
    expect(parseQueueQuery({})).toEqual({ lane: 'scheduled', limit: 25, offset: 0 })
  })
  it('caps the page size at 50 and turns page into an offset', () => {
    expect(parseQueueQuery({ limit: '500', page: '3' })).toMatchObject({ limit: 50, offset: 100 })
  })
  it('accepts a city and a pickup window for the scheduled lane', () => {
    expect(parseQueueQuery({ city_id: '2', within: '60' })).toMatchObject({ lane: 'scheduled', cityId: 2, withinMinutes: 60 })
  })
  it('ignores the pickup window on the needs-driver lane', () => {
    expect(parseQueueQuery({ lane: 'needs_driver', within: '60' }).withinMinutes).toBeUndefined()
  })
  it.each([
    ['an unknown lane', { lane: 'x' }],
    ['a non-numeric page', { page: 'abc' }],
    ['a zero city', { city_id: '0' }],
    ['a fractional limit', { limit: '2.5' }],
    ['a window that is not offered', { within: '45' }],
  ])('refuses %s', (_l, q) => { expect(() => parseQueueQuery(q)).toThrow() })
})

describe('dispatch summary', () => {
  it('is five counts, each over a status that is rare by nature', async () => {
    poolQuery.mockResolvedValue({ rows: [{}] })
    await getDispatchSummary()
    const sql = sqls()[0]!
    for (const alias of ['scheduled_total', 'due_within_60m', 'overdue', 'searching_long', 'no_drivers']) expect(sql).toContain(alias)
    // every count is filtered by a status, never a bare count of the rides table
    expect((sql.match(/FROM rides/g) ?? []).length).toBe((sql.match(/status = '/g) ?? []).length)
  })
})

describe('dispatch queue', () => {
  it('scheduled lane reads only status = scheduled, soonest pickup first, paged before joins', async () => {
    await listDispatchQueue({ lane: 'scheduled', limit: 25, offset: 50 })
    const data = sqls()[1]!
    expect(data).toMatch(/r\.status = 'scheduled'/)
    expect(data).toMatch(/ORDER BY sort_at ASC, id ASC\s+LIMIT \$1 OFFSET \$2/)
    expect(poolQuery.mock.calls[1]![1]).toEqual([25, 50])
  })

  it('the count is capped so it never counts every row', async () => {
    await listDispatchQueue({ lane: 'scheduled', limit: 25, offset: 0 })
    expect(sqls()[0]).toMatch(/LIMIT 10001/)
  })

  it('city and window are bound parameters, and the city is one parameter even when used twice', async () => {
    await listDispatchQueue({ lane: 'needs_driver', cityId: 4, limit: 10, offset: 0 })
    const [countSql, countParams] = poolQuery.mock.calls[0]!
    expect(countParams).toEqual([4])
    expect((String(countSql).match(/origin_city_id = \$1/g) ?? []).length).toBe(2)
    await listDispatchQueue({ lane: 'scheduled', cityId: 4, withinMinutes: 60, limit: 10, offset: 0 })
    expect(poolQuery.mock.calls.at(-1)![1]).toEqual([60, 4, 10, 0])
    expect(sqls().at(-1)).toMatch(/make_interval\(mins => \$1::int\)/)
    expect(sqls().at(-1)).toMatch(/origin_city_id = \$2/)
  })

  it('needs-driver lane is searching-too-long plus recent no-driver rides, measured from dispatch time not booking time', async () => {
    await listDispatchQueue({ lane: 'needs_driver', limit: 25, offset: 0 })
    const data = sqls()[1]!
    expect(data).toMatch(/r\.status = 'requested'/)
    expect(data).toMatch(/r\.status = 'no_drivers' AND r\.requested_at >= now\(\) - interval '24 hours'/)
    // an advance booking keeps its booking-time requested_at, so waiting is counted from scheduled_for minus the buffer
    expect(data).toMatch(/COALESCE\(r\.scheduled_for - \(ram\.dispatch_buffer_minutes/)
  })
})
