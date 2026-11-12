import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/pricing/pricing.repository', () => ({
  getCurrentRateCard: vi.fn(),
  getActiveSurge:     vi.fn().mockResolvedValue(null),
  getRentalPackage:   vi.fn(),
}))

import * as repo from '@/modules/pricing/pricing.repository'
import { getFareEstimate } from '@/modules/pricing/pricing.service'

const pkg = (over: Record<string, unknown> = {}) => ({
  id: 12, category_id: 2, duration_minutes: 240, km_limit: 40,
  package_fare: '500.00', extra_per_km: '8.00', extra_per_min: '1.00',
  stop_charge: '15.00', cancellation_fee: '50.00', ...over,
})
const RENTAL = { category_id: 2, ride_type: 'rental' as const, distance_km: 0, duration_min: 0, rental_package_id: 12 }

describe('getFareEstimate: a package rental needs no rate card', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getCurrentRateCard).mockRejectedValue(new Error('a package rental must not read a rate card'))
  })

  it('quotes the package fare, with the package stop charge and no rate card id', async () => {
    vi.mocked(repo.getRentalPackage).mockResolvedValue(pkg() as never)
    const res = await getFareEstimate({ ...RENTAL, stop_count: 2 })

    expect(repo.getCurrentRateCard).not.toHaveBeenCalled()
    expect(res.rate_card_id).toBeNull()
    expect(res.breakdown.total).toBe(500)
    expect(res.charge_per_stop).toBe(15)
    expect(res.rental_hours).toBe(4)
  })

  it('treats a package with no stop_charge (stale cache) as free rather than NaN', async () => {
    vi.mocked(repo.getRentalPackage).mockResolvedValue(pkg({ stop_charge: undefined }) as never)
    const res = await getFareEstimate(RENTAL)

    expect(res.charge_per_stop).toBe(0)
    expect(Number.isFinite(res.breakdown.total)).toBe(true)
  })

  it('refuses a rental whose package is missing or inactive, instead of pricing it on a card', async () => {
    vi.mocked(repo.getRentalPackage).mockResolvedValue(null as never)
    await expect(getFareEstimate(RENTAL)).rejects.toMatchObject({ httpStatus: 422 })
    expect(repo.getCurrentRateCard).not.toHaveBeenCalled()
  })
})

describe('getFareEstimate: the package must belong to the vehicle and the city being quoted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getCurrentRateCard).mockRejectedValue(new Error('a package rental must not read a rate card'))
  })

  it('refuses another category\'s package (a cheaper package must not price a dearer car)', async () => {
    vi.mocked(repo.getRentalPackage).mockResolvedValue(pkg({ category_id: 3 }) as never)
    await expect(getFareEstimate(RENTAL)).rejects.toMatchObject({ httpStatus: 422 })
  })

  it('refuses a package that is specific to another city', async () => {
    vi.mocked(repo.getRentalPackage).mockResolvedValue(pkg({ city_id: 5 }) as never)
    await expect(getFareEstimate({ ...RENTAL, city_id: 1 })).rejects.toMatchObject({ httpStatus: 422 })
  })

  it('accepts a global package for any city, and a city package for its own city', async () => {
    vi.mocked(repo.getRentalPackage).mockResolvedValue(pkg({ city_id: null }) as never)
    expect((await getFareEstimate({ ...RENTAL, city_id: 9 })).breakdown.total).toBe(500)
    vi.mocked(repo.getRentalPackage).mockResolvedValue(pkg({ city_id: 5 }) as never)
    expect((await getFareEstimate({ ...RENTAL, city_id: 5 })).breakdown.total).toBe(500)
  })

  it('does not check the city when the request names none (older clients quote without one)', async () => {
    vi.mocked(repo.getRentalPackage).mockResolvedValue(pkg({ city_id: 5 }) as never)
    expect((await getFareEstimate(RENTAL)).breakdown.total).toBe(500)
  })
})

describe('getFareEstimate: everything else still needs its rate card', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('a one-way quote with no rate card is still a 422', async () => {
    vi.mocked(repo.getCurrentRateCard).mockResolvedValue(null as never)
    await expect(getFareEstimate({ category_id: 2, ride_type: 'one_way', distance_km: 10, duration_min: 20 }))
      .rejects.toMatchObject({ httpStatus: 422 })
  })

  it('a rental quote with no package id (legacy request) still reads the rental card', async () => {
    vi.mocked(repo.getCurrentRateCard).mockResolvedValue({
      id: 9, rate_per_km: '9.00', rate_per_min: '1.00', min_fare: '100.00', stop_charge: '0',
    } as never)
    const res = await getFareEstimate({ category_id: 2, ride_type: 'rental', distance_km: 10, duration_min: 20 })
    expect(repo.getCurrentRateCard).toHaveBeenCalledWith(2, 'rental', null)
    expect(res.rate_card_id).toBe(9)
  })
})
