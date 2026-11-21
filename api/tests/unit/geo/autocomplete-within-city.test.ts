import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/geo/geo.repository', () => ({ findCitySearchCircle: vi.fn() }))
vi.mock('@/modules/geo/providers/google.provider', () => ({ autocomplete: vi.fn().mockResolvedValue([]) }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: {}, getJSON: vi.fn(), setWithTTL: vi.fn() }))

import * as repo from '@/modules/geo/geo.repository'
import * as google from '@/modules/geo/providers/google.provider'
import { autocomplete } from '@/modules/geo/geo.service'

const CIRCLE = { lat: 20.27, lng: 85.84, radiusM: 18000 }

describe('autocomplete within the pickup city', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(repo.findCitySearchCircle).mockResolvedValue(CIRCLE) })

  it('limits the search to the city circle when asked', async () => {
    await autocomplete('patia', 20.3, 85.8, true)
    expect(google.autocomplete).toHaveBeenCalledWith('patia', 20.3, 85.8, CIRCLE)
  })

  it('searches as before when not asked', async () => {
    await autocomplete('patia', 20.3, 85.8)
    expect(repo.findCitySearchCircle).not.toHaveBeenCalled()
    expect(google.autocomplete).toHaveBeenCalledWith('patia', 20.3, 85.8, undefined)
  })

  it('searches as before when the pickup is in no city', async () => {
    vi.mocked(repo.findCitySearchCircle).mockResolvedValue(null)
    await autocomplete('patia', 20.3, 85.8, true)
    expect(google.autocomplete).toHaveBeenCalledWith('patia', 20.3, 85.8, undefined)
  })
})
