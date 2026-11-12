import { describe, it, expect, vi, beforeEach } from 'vitest'

const world = vi.hoisted(() => ({ flagOn: true, city: { id: 1, name: 'Bhubaneswar' } as { id: number; name: string } | null }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ getJSON: vi.fn(), setWithTTL: vi.fn(), client: {} }))
vi.mock('@/modules/geo/geo.repository', () => ({ findContainingCity: vi.fn(async () => world.city) }))
vi.mock('@/lib/system-config', () => ({
  getConfigValue: vi.fn(async (key: string, fallback: string) => (key === 'city_rides_enabled' ? (world.flagOn ? 'true' : 'false') : fallback)),
}))

import { classifyTrip } from '@/modules/geo/geo.service'

describe('classifyTrip: city_ride_available', () => {
  beforeEach(() => { world.flagOn = true; world.city = { id: 1, name: 'Bhubaneswar' } })

  it('is true for an in-city trip while the switch is on, with no distance cap', async () => {
    expect(await classifyTrip(20.2961, 85.8245, 20.4625, 85.8828)).toMatchObject({ scope: 'in_city', cityName: 'Bhubaneswar', city_ride_available: true })
  })

  it('is false while the switch is off, and the existing fields are unchanged', async () => {
    world.flagOn = false
    expect(await classifyTrip(20.2961, 85.8245, 20.4625, 85.8828)).toEqual({ scope: 'in_city', cityId: 1, cityName: 'Bhubaneswar', city_ride_available: false })
  })

  it('is false for a trip that leaves the region', async () => {
    world.city = null
    expect(await classifyTrip(20.2961, 85.8245, 19.8, 85.83)).toEqual({ scope: 'outstation', cityId: null, cityName: null, city_ride_available: false })
  })
})
