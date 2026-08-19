import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/geo/geo.repository', () => ({
  findContainingCity: vi.fn(),
}))

import * as repo from '@/modules/geo/geo.repository'
import { classifyTrip } from '@/modules/geo/geo.service'

// classifyTrip's scope decides real billing: 'in_city' rides are priced
// per-km, 'outstation' rides fall back to flat/package pricing. A silent
// regression here is a fare bug, not just a data-classification bug.
describe('classifyTrip', () => {
  beforeEach(() => vi.clearAllMocks())

  it('classifies as in_city with the containing city id/name when both origin and destination fall inside one city boundary', async () => {
    vi.mocked(repo.findContainingCity).mockResolvedValue({ id: 1, name: 'Bhubaneswar' })

    const result = await classifyTrip(20.2961, 85.8245, 20.30, 85.83)

    expect(result).toEqual({ scope: 'in_city', cityId: 1, cityName: 'Bhubaneswar' })
    expect(repo.findContainingCity).toHaveBeenCalledWith(20.2961, 85.8245, 20.30, 85.83)
  })

  it('classifies as outstation with null city fields when no single city boundary contains both points', async () => {
    vi.mocked(repo.findContainingCity).mockResolvedValue(null)

    // Bhubaneswar -> Puri, crosses city lines. Known limitation this test
    // documents rather than papers over: findContainingCity's single-row
    // query can't distinguish "the two points are in two different cities"
    // from "no city contains either point" — both collapse to the same
    // null result and both correctly bill as outstation, so a third test
    // case for "two different cities" would be redundant with this one.
    const result = await classifyTrip(20.2961, 85.8245, 19.8135, 85.8312)

    expect(result).toEqual({ scope: 'outstation', cityId: null, cityName: null })
  })
})
