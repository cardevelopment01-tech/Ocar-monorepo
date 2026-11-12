import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() }, withTransaction: vi.fn() }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))

import { pool } from '@/db/client'
import { getRideStopCharge, insertFareSnapshot, getRentalSettlementInputs, updateFareSnapshotEstimate } from '@/modules/rides/rides.repository'

const sqlOf = (mock: { mock: { calls: unknown[][] } }, i = 0) => String(mock.mock.calls[i]![0])

describe('getRideStopCharge', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('prefers the stop charge saved on the ride, then the rate card it was quoted on', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ stop_charge: '15' }] } as never)
    expect(await getRideStopCharge(7n)).toBe(15)
    const sql = sqlOf(vi.mocked(pool.query))
    expect(sql).toMatch(/COALESCE\(fs\.rental_stop_charge,\s*rc\.stop_charge\)/)
    // a rental with no rate card must still resolve its charge from the snapshot
    expect(sql).toMatch(/LEFT JOIN rate_cards rc ON rc\.id = fs\.rate_card_id/)
  })

  it('is 0 when neither the snapshot nor a card gives a charge, or the ride is unknown', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ stop_charge: null }] } as never)
    expect(await getRideStopCharge(7n)).toBe(0)
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never)
    expect(await getRideStopCharge(8n)).toBe(0)
  })
})

describe('insertFareSnapshot', () => {
  it('saves the package stop charge and cancellation fee beside the other pinned package terms', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await insertFareSnapshot(client as never, {
      rideId: 1n, rateCardId: 1, rentalPackageId: 5, rideType: 'rental', isReturnCab: false, surgeEventId: null,
      surgeMultiplier: 1, estimatedKm: 0, estimatedMin: 0, stopCount: 0, tripHours: 4, baseFare: 500, distanceFare: 0,
      timeFare: 0, stopFare: 0, hourSurcharge: 0, surgeFare: 0, total: 500, pricingVersion: 1, waitingFare: 0, discountAmount: 0,
    } as never)
    const sql = String(client.query.mock.calls[0]![0])
    expect(sql).toMatch(/rental_stop_charge/)
    expect(sql).toMatch(/rental_cancellation_fee/)
    expect(sql).toMatch(/SELECT stop_charge\s+FROM rental_packages WHERE id = \$3/)
    expect(sql).toMatch(/SELECT cancellation_fee\s+FROM rental_packages WHERE id = \$3/)
  })
})

describe('a rental with no rate card (migration 136) still settles and re-quotes', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('settlement reads the package terms and the snapshot only, never a rate card', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ base_fare: '500', surge_multiplier: '1', km_limit: '40', duration_minutes: 240, extra_per_km: '8', extra_per_min: '1' }] } as never)
    expect(await getRentalSettlementInputs(7n)).toMatchObject({ km_limit: '40' })
    const sql = sqlOf(vi.mocked(pool.query))
    expect(sql).not.toMatch(/rate_cards/)
    expect(sql).toMatch(/JOIN rental_packages rp/)
  })

  it('the scheduled-ride re-quote can store a null rate card id', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never)
    await updateFareSnapshotEstimate(7n, {
      rate_card_id: null, surge_event_id: null, surge_multiplier: 1,
      breakdown: { base_fare: 500, distance_fare: 0, time_fare: 0, stop_fare: 0, hour_surcharge: 0, surge_fare: 0, total: 500 },
    })
    expect(vi.mocked(pool.query).mock.calls[0]![1]![1]).toBeNull()
  })
})
