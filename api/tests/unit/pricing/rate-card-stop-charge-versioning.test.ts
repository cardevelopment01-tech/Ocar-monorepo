import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── rate card versioning: the per-stop price survives a new version ──────────
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

import { createRateCard } from '@/modules/pricing/pricing.repository'

const BASE = { categoryId: 2, rideType: 'round_trip', ratePerKm: 16, ratePerMin: 1.8, minFare: 120, adminId: 9 }
const OLD = {
  id: 5, rate_per_km: '15.00', rate_per_min: '1.70', min_fare: '110.00', return_rate_per_km: null,
  hour_rate: '28.00', km_per_day: null, driver_allowance_per_day: null, city_id: null, stop_charge: '25.00', cancellation_fee: '50.00',
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
const insertedHistory = () => query.mock.calls.find(c => /INSERT INTO rate_card_history/.test(c[0]))!

describe('createRateCard — stop_charge', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("carries the previous version's stop_charge forward when none is supplied", async () => {
    wire([OLD])
    await createRateCard(BASE)

    expect(insertedCard()[1].at(-2)).toBe(25)
  })

  it('uses the supplied stop_charge, including 0 (= make stops free)', async () => {
    wire([OLD])
    await createRateCard({ ...BASE, stopCharge: 0 })
    expect(insertedCard()[1].at(-2)).toBe(0)

    wire([OLD])
    await createRateCard({ ...BASE, stopCharge: 40 })
    expect(insertedCard()[1].at(-2)).toBe(40)
  })

  it('a brand-new card (no previous version) defaults to 0', async () => {
    wire([])
    await createRateCard(BASE)

    expect(insertedCard()[1].at(-2)).toBe(0)
  })

  it('records the replaced version\'s stop_charge in the history row', async () => {
    wire([OLD])
    await createRateCard({ ...BASE, stopCharge: 40 })

    expect(insertedHistory()[1].at(-1)).toBe('25.00')
  })

  it('carries the previous cancellation_fee forward instead of resetting it to NULL', async () => {
    wire([OLD])
    await createRateCard(BASE)
    expect(insertedCard()[1].at(-1)).toBe('50.00')
  })
})
