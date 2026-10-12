import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── quote: per-stop price comes from the rate card ───────────────────────────
vi.mock('@/modules/pricing/pricing.repository', () => ({
  getCurrentRateCard: vi.fn(),
  getActiveSurge:     vi.fn().mockResolvedValue(null),
  getRentalPackage:   vi.fn().mockResolvedValue(null),
}))

import * as repo from '@/modules/pricing/pricing.repository'
import { getFareEstimate } from '@/modules/pricing/pricing.service'

const card = (over: Record<string, unknown> = {}) => ({
  id: 7, rate_per_km: '16.00', rate_per_min: '1.80', min_fare: '120.00',
  return_rate_per_km: null, hour_rate: '28.00', km_per_day: null, driver_allowance_per_day: null,
  ...over,
})
const REQ = { category_id: 2, distance_km: 20, duration_min: 30, stop_count: 2 }

describe('getFareEstimate — rate_cards.stop_charge', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it.each(['one_way', 'round_trip', 'rental'] as const)('%s: charges stop_count x the card stop_charge', async (rideType) => {
    vi.mocked(repo.getCurrentRateCard).mockResolvedValue(card({ stop_charge: '20.00' }) as never)
    const res = await getFareEstimate({ ...REQ, ride_type: rideType, trip_hours: 4 })

    expect(res.charge_per_stop).toBe(20)
    expect(res.breakdown.stop_fare).toBe(40)
  })

  it('a card with stop_charge 0 means stops are free', async () => {
    vi.mocked(repo.getCurrentRateCard).mockResolvedValue(card({ stop_charge: '0.00' }) as never)
    const res = await getFareEstimate({ ...REQ, ride_type: 'round_trip', trip_hours: 4 })

    expect(res.charge_per_stop).toBe(0)
    expect(res.breakdown.stop_fare).toBe(0)
  })

  it('treats a card with no stop_charge (stale cache, old row) as free rather than failing', async () => {
    vi.mocked(repo.getCurrentRateCard).mockResolvedValue(card() as never)
    const res = await getFareEstimate({ ...REQ, ride_type: 'one_way' })

    expect(res.charge_per_stop).toBe(0)
    expect(res.breakdown.stop_fare).toBe(0)
  })
})
