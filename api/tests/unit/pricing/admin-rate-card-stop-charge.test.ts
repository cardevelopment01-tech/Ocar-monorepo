import { describe, it, expect, vi, beforeEach } from 'vitest'

// The admin rate-card form posts to createAdminRateCard (admin.repository), a sibling of the
// pricing module's createRateCard. Same rule: a new version keeps the stop price unless told otherwise.
const query = vi.fn()
const client = { query, release: vi.fn() }
vi.mock('@/db/client', () => ({
  pool: { connect: vi.fn(async () => client), query: vi.fn() },
  withTransaction: vi.fn(),
}))
vi.mock('@/db/redis', () => ({
  getJSON: vi.fn().mockResolvedValue(null),
  setWithTTL: vi.fn().mockResolvedValue(undefined),
  withTimeout: vi.fn(async (p: Promise<unknown>) => p),
  client: { incr: vi.fn().mockResolvedValue(1), del: vi.fn().mockResolvedValue(1), get: vi.fn() },
}))

import { createAdminRateCard } from '@/modules/admin/admin.repository'

const BASE = { categoryId: 2, rideType: 'one_way', ratePerKm: 16, ratePerMin: 1.8, minFare: 120, adminId: 9n }
const OLD = {
  id: 5, rate_per_km: '15.00', rate_per_min: '1.70', min_fare: '110.00', return_rate_per_km: null,
  hour_rate: null, km_per_day: null, driver_allowance_per_day: null, city_id: null, stop_charge: '15.00', cancellation_fee: '50.00',
}

function wire(expired: unknown[]) {
  query.mockReset()
  query.mockImplementation(async (sql: string) => {
    if (/^\s*UPDATE rate_cards/.test(sql)) return { rows: expired }
    if (/^\s*INSERT INTO rate_cards/.test(sql)) return { rows: [{ id: 6 }] }
    return { rows: [] }
  })
}
const insertedCard = () => query.mock.calls.find(c => /INSERT INTO rate_cards/.test(c[0]))!

describe('createAdminRateCard — stop_charge', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('keeps the previous stop_charge when the form does not send one', async () => {
    wire([OLD])
    await createAdminRateCard(BASE)
    expect(insertedCard()[1].at(-2)).toBe(15)
  })

  it('applies an explicit stop_charge, including 0', async () => {
    wire([OLD])
    await createAdminRateCard({ ...BASE, stopCharge: 0 })
    expect(insertedCard()[1].at(-2)).toBe(0)
    wire([OLD])
    await createAdminRateCard({ ...BASE, stopCharge: 30 })
    expect(insertedCard()[1].at(-2)).toBe(30)
  })

  it('carries the previous cancellation_fee forward instead of resetting it to NULL', async () => {
    wire([OLD])
    await createAdminRateCard(BASE)
    expect(insertedCard()[1].at(-1)).toBe('50.00')
  })
})
