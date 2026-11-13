import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }))
vi.mock('@/db/redis', () => ({
  getJSON: vi.fn(), setWithTTL: vi.fn(), withTimeout: vi.fn(async (p: Promise<unknown>) => p),
  client: { incr: vi.fn(), del: vi.fn(), get: vi.fn() },
}))

import { listAdminRides } from '@/modules/admin/admin.repository'

const base = { limit: 20, offset: 0 }
const sqls = () => poolQuery.mock.calls.map((c) => String(c[0]))

describe('listAdminRides: ride type filter with city rides', () => {
  beforeEach(() => { vi.clearAllMocks(); poolQuery.mockResolvedValue({ rows: [{ count: '1' }] }) })

  it('City ride is a one-way ride with trip mode city', async () => {
    await listAdminRides({ ...base, ride_type: 'city' })
    expect(sqls()[0]).toMatch(/r\.ride_type = 'one_way' AND r\.trip_mode = 'city'/)
  })

  it('One Way means the intercity one-way (standard), so city rides do not hide inside it', async () => {
    await listAdminRides({ ...base, ride_type: 'one_way' })
    expect(sqls()[0]).toMatch(/r\.ride_type = 'one_way' AND r\.trip_mode = 'standard'/)
  })

  it('round trip and rental filters are unchanged', async () => {
    await listAdminRides({ ...base, ride_type: 'rental' })
    expect(sqls()[0]).toMatch(/r\.ride_type = \$1/)
    expect(poolQuery.mock.calls[0]![1]).toEqual(['rental'])
  })

  it('the list rows carry trip_mode so the screen can label a city ride', async () => {
    await listAdminRides(base)
    expect(sqls().some((s) => /r\.ride_type, r\.trip_mode, r\.is_return_cab/.test(s))).toBe(true)
  })
})
