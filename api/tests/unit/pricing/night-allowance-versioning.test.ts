import { describe, it, expect, vi, beforeEach } from 'vitest'

// A new rate card version must keep the night allowance an admin set earlier unless told otherwise (the same rule as stop_charge and
// base_fare), on BOTH create paths: the admin form's createAdminRateCard and the pricing module's createRateCard.
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
import { createRateCard } from '@/modules/pricing/pricing.repository'

const BASE = { categoryId: 2, rideType: 'one_way', ratePerKm: 16, ratePerMin: 1.8, minFare: 120, adminId: 9n }
const OLD = {
  id: 5, rate_per_km: '15.00', rate_per_min: '1.70', min_fare: '110.00', return_rate_per_km: null,
  hour_rate: null, km_per_day: null, driver_allowance_per_day: null, city_id: null,
  stop_charge: '15.00', cancellation_fee: '50.00', base_fare: '0', night_allowance_per_night: '300.00',
}

function wire(expired: unknown[]) {
  query.mockReset()
  query.mockImplementation(async (sql: string) => {
    if (/^\s*UPDATE rate_cards/.test(sql)) return { rows: expired }
    if (/^\s*INSERT INTO rate_cards/.test(sql)) return { rows: [{ id: 6 }] }
    return { rows: [] }
  })
}
const insert = () => query.mock.calls.find(c => /INSERT INTO rate_cards/.test(c[0]))!
// Counted from the end, like the stop-charge tests: night_allowance_per_night sits just before stop_charge (7th from last).
const nightParam = () => insert()[1].at(-7)

describe.each([
  ['createAdminRateCard', createAdminRateCard],
  ['createRateCard', createRateCard],
])('%s: night allowance', (_name, create) => {
  beforeEach(() => { vi.clearAllMocks() })

  it('names the column in the INSERT, in the same position as its value', () => {
    wire([OLD])
    return create(BASE as never).then(() => {
      const sql = insert()[0] as string
      const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map(c => c.trim())
      expect(cols[cols.length - 7]).toBe('night_allowance_per_night')
      expect(cols[cols.length - 6]).toBe('stop_charge')
    })
  })

  it('keeps the previous version\'s allowance when the form does not send one', async () => {
    wire([OLD])
    await create(BASE as never)
    expect(nightParam()).toBe(300)
  })

  it('applies an explicit allowance, including 0 to switch it off', async () => {
    wire([OLD])
    await create({ ...BASE, nightAllowancePerNight: 250 } as never)
    expect(nightParam()).toBe(250)
    wire([OLD])
    await create({ ...BASE, nightAllowancePerNight: 0 } as never)
    expect(nightParam()).toBe(0)
  })

  it('a brand-new card (no previous version) starts at 0 = off', async () => {
    wire([])
    await create(BASE as never)
    expect(nightParam()).toBe(0)
  })
})
