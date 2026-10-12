import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/pricing/pricing.repository', () => ({
  getCurrentRateCard: vi.fn().mockResolvedValue(null), // reaching here means the range guard passed
  getActiveSurge: vi.fn(), getRentalPackage: vi.fn(),
}))

import { getFareEstimate } from '@/modules/pricing/pricing.service'

const base = { category_id: 1, ride_type: 'one_way', distance_km: 50, duration_min: 60 } as never

describe('getFareEstimate - input range guard', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['NaN distance', { distance_km: NaN }],
    ['negative distance', { distance_km: -5 }],
    ['absurd distance', { distance_km: 1e9 }],
    ['absurd duration', { duration_min: 1e9 }],
    ['fractional stop count', { stop_count: 1.5 }],
    ['absurd stop count', { stop_count: 500 }],
    ['absurd trip hours', { trip_hours: 1e9 }],
    ['string distance', { distance_km: '50' }],
  ])('rejects %s with 422 before any lookup', async (_n, patch) => {
    await expect(getFareEstimate({ ...(base as object), ...patch } as never)).rejects.toMatchObject({ httpStatus: 422 })
  })

  it('lets sane input through to the rate-card lookup (which then reports no rate card)', async () => {
    await expect(getFareEstimate(base)).rejects.toThrow(/No rate card/)
  })

  it('leaves an absent field to existing handling (rental quotes may omit distance)', async () => {
    await expect(getFareEstimate({ category_id: 1, ride_type: 'rental' } as never)).rejects.toThrow(/No rate card/)
  })
})
