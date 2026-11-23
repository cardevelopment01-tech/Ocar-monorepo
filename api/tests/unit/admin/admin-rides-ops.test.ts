import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }))
vi.mock('@/db/redis', () => ({
  getJSON: vi.fn(), setWithTTL: vi.fn(), withTimeout: vi.fn(async (p: Promise<unknown>) => p),
  client: { incr: vi.fn(), del: vi.fn(), get: vi.fn() },
}))

import { listAdminRides, getAdminRideStats, listUpcomingScheduledRides, getRideOffers, getRideTrail } from '@/modules/admin/admin.repository'

const base = { limit: 20, offset: 0 }
const sqls = () => poolQuery.mock.calls.map((c) => String(c[0]))

beforeEach(() => { vi.clearAllMocks(); poolQuery.mockResolvedValue({ rows: [{ n: 0 }] }) })

describe('rides stats', () => {
  it('counts active rides in two halves, each matching a partial index, and includes returning', async () => {
    poolQuery.mockResolvedValue({ rows: [{}] })
    await getAdminRideStats()
    const sql = sqls()[0]!
    expect(sql).toMatch(/status IN \('accepted','driver_arrived'\)/)
    expect(sql).toMatch(/status IN \('in_progress','returning'\)/)
    expect(sql).not.toMatch(/IN \('accepted','driver_arrived','in_progress'\)/)
    expect(sql).toMatch(/needs_attention_count/)
  })
})

describe('needs-attention filter', () => {
  it('is three small index-backed sets, never a bare scan of rides', async () => {
    await listAdminRides({ ...base, attention: true })
    const sql = sqls()[0]!
    expect(sql).toMatch(/review_flagged_at IS NOT NULL/)
    expect(sql).toMatch(/r\.cash_discrepancy AND r\.requested_at >= now\(\) - interval '7 days'/)
    expect(sql).toMatch(/r\.status = 'no_drivers' AND r\.requested_at >= now\(\) - interval '24 hours'/)
    expect((sql.match(/UNION/g) ?? []).length).toBe(2)
  })

  it('applies the other filters inside every set', async () => {
    await listAdminRides({ ...base, attention: true, city_id: 3 })
    const sql = sqls()[0]!
    expect((sql.match(/r\.origin_city_id = \$1/g) ?? []).length).toBe(3)
    expect(poolQuery.mock.calls[0]![1]).toEqual([3])
  })

  it('with a search it narrows the search results instead of replacing them', async () => {
    await listAdminRides({ ...base, attention: true, search: 'ravi' })
    const all = sqls().join(' ')
    expect(all).toMatch(/ILIKE/)
    expect(all).toMatch(/r\.id IN \(SELECT id FROM \(/)
  })

  it('is off by default', async () => {
    await listAdminRides(base)
    expect(sqls()[0]).not.toMatch(/review_flagged_at IS NOT NULL/)
  })
})

describe('upcoming scheduled rides', () => {
  it('is bounded', async () => {
    poolQuery.mockResolvedValue({ rows: [] })
    await listUpcomingScheduledRides()
    expect(sqls()[0]).toMatch(/LIMIT 50/)
  })
})

describe('ride offers and trail', () => {
  it('offers come from ride_assignments in offer order, capped', async () => {
    poolQuery.mockResolvedValue({ rows: [] })
    await getRideOffers(7n)
    const sql = sqls()[0]!
    expect(sql).toMatch(/FROM ride_assignments a/)
    expect(sql).toMatch(/ORDER BY a\.offered_at ASC/)
    expect(sql).toMatch(/LIMIT 200/)
  })

  it('the trail query is bounded by a time window (partition pruning) and thinned to the point cap', async () => {
    poolQuery.mockResolvedValue({ rows: [] })
    const from = new Date('2026-11-20T10:00:00Z'); const to = new Date('2026-11-20T11:00:00Z')
    await getRideTrail(7n, from, to, 300)
    expect(sqls()[0]).toMatch(/recorded_at >= \$2 AND recorded_at <= \$3/)
    expect(poolQuery.mock.calls[0]![1]).toEqual([7n, from, to, 300])
  })
})
