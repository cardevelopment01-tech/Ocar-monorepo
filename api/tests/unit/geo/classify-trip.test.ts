import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/geo/geo.repository', () => ({
  findContainingCity: vi.fn(),
}))

import * as repo from '@/modules/geo/geo.repository'
import { classifyTrip } from '@/modules/geo/geo.service'

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

    const result = await classifyTrip(20.2961, 85.8245, 19.8135, 85.8312) // Bhubaneswar -> Puri, crosses city lines

    expect(result).toEqual({ scope: 'outstation', cityId: null, cityName: null })
  })
})
