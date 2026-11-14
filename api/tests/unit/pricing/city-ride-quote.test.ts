import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/pricing/pricing.repository', () => ({
  getCurrentRateCard: vi.fn(),
  getActiveSurge: vi.fn().mockResolvedValue(null),
  getRentalPackage: vi.fn().mockResolvedValue(null),
}))

import * as repo from '@/modules/pricing/pricing.repository'
import { getFareEstimate } from '@/modules/pricing/pricing.service'

const card = (over: Record<string, unknown> = {}) => ({ id: 21, rate_per_km: '9.00', rate_per_min: '1.00', min_fare: '100.00', stop_charge: '0', ...over })
const REQ = { category_id: 2, ride_type: 'one_way' as const, distance_km: 28, duration_min: 45 }

describe('getFareEstimate: trip mode', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('a city quote reads the city card and prices on its rates', async () => {
    vi.mocked(repo.getCurrentRateCard).mockResolvedValue(card() as never)
    const res = await getFareEstimate({ ...REQ, trip_mode: 'city' })
    expect(repo.getCurrentRateCard).toHaveBeenCalledWith(2, 'one_way', null, 'city')
    expect(res.rate_card_id).toBe(21)
    expect(res.breakdown.total).toBe(297) // 28 km x 9 + 45 min x 1, the Sedan city numbers
  })

  it('a quote with no trip mode reads the standard card, as every existing caller does', async () => {
    vi.mocked(repo.getCurrentRateCard).mockResolvedValue(card({ rate_per_km: '13.00', rate_per_min: '2.00', min_fare: '250.00' }) as never)
    await getFareEstimate(REQ)
    expect(repo.getCurrentRateCard).toHaveBeenCalledWith(2, 'one_way', null, 'standard')
  })

  it('anything other than "city" is the standard card (a public caller cannot invent a mode)', async () => {
    vi.mocked(repo.getCurrentRateCard).mockResolvedValue(card() as never)
    await getFareEstimate({ ...REQ, trip_mode: 'bogus' as never })
    expect(repo.getCurrentRateCard).toHaveBeenCalledWith(2, 'one_way', null, 'standard')
  })

  it('says City ride is not available for the vehicle when it has no city card (never a 500)', async () => {
    vi.mocked(repo.getCurrentRateCard).mockResolvedValue(null as never)
    await expect(getFareEstimate({ ...REQ, trip_mode: 'city' })).rejects.toMatchObject({
      httpStatus: 422,
      appCode: 'CITY_RIDE_UNAVAILABLE',
      message: expect.stringContaining('not available for this vehicle'),
    })
  })

  it('keeps the old message for a standard quote with no card', async () => {
    vi.mocked(repo.getCurrentRateCard).mockResolvedValue(null as never)
    await expect(getFareEstimate(REQ)).rejects.toMatchObject({ httpStatus: 422, message: expect.stringContaining('No rate card') })
  })
})
