import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/geo/geo.repository', () => ({
  createCity: vi.fn(),
  updateCity: vi.fn(),
}))

import * as repo from '@/modules/geo/geo.repository'
import { createCity, updateCity } from '@/modules/geo/geo.service'

const NEW_CITY = {
  name: 'Rourkela', slug: 'rourkela', state: 'Odisha',
  centroid_lat: 22.2604, centroid_lng: 84.8536,
  default_speed_limit_kmph: 40, is_rental_enabled: false, is_return_cab_enabled: false,
  created_by: 1n,
}

describe('createCity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes the data straight through to the repository and returns its result', async () => {
    vi.mocked(repo.createCity).mockResolvedValue({
      id: 9,
      name: NEW_CITY.name,
      slug: NEW_CITY.slug,
      state: NEW_CITY.state,
      centroid_lat: NEW_CITY.centroid_lat,
      centroid_lng: NEW_CITY.centroid_lng,
      default_speed_limit_kmph: NEW_CITY.default_speed_limit_kmph,
      status: 'draft',
      is_rental_enabled: NEW_CITY.is_rental_enabled,
      is_return_cab_enabled: NEW_CITY.is_return_cab_enabled,
      created_at: '2026-08-19T00:00:00.000Z',
    })

    const result = await createCity(NEW_CITY)

    expect(repo.createCity).toHaveBeenCalledWith(NEW_CITY)
    expect(result).toEqual(expect.objectContaining({ id: 9, name: 'Rourkela' }))
  })
})

describe('updateCity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws httpStatus 404 when the city does not exist', async () => {
    vi.mocked(repo.updateCity).mockResolvedValue(null)

    await expect(updateCity(999n, { name: 'New Name' })).rejects.toMatchObject({ httpStatus: 404 })
  })

  it('returns the updated city on success', async () => {
    vi.mocked(repo.updateCity).mockResolvedValue({
      id: 1,
      name: 'Bhubaneswar Updated',
      slug: 'bhubaneswar',
      state: 'Odisha',
      centroid_lat: 20.2961,
      centroid_lng: 85.8245,
      default_speed_limit_kmph: 40,
      status: 'active',
      is_rental_enabled: true,
      is_return_cab_enabled: true,
      created_at: '2026-08-19T00:00:00.000Z',
    })

    const result = await updateCity(1n, { name: 'Bhubaneswar Updated' })

    expect(result).toEqual(expect.objectContaining({ id: 1, name: 'Bhubaneswar Updated' }))
    expect(repo.updateCity).toHaveBeenCalledWith(1n, { name: 'Bhubaneswar Updated' })
  })
})
