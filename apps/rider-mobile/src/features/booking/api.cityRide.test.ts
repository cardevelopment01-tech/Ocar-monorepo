import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
const post = vi.fn()
vi.mock('@/services/api', () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }))
vi.mock('@ocar/mobile-shared', () => {
  const camel = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(camel)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), camel(x)]))
    : v
  return { camelizeKeys: camel, getApiErrorMessage: () => '', track: vi.fn() }
})

import { fetchClassifyTrip, fetchFareEstimate, createBooking } from './api'
import { previewOffer } from '../offers/api'
import { useBookingDraftStore } from './store'

describe('fetchClassifyTrip', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('reads the city ride hint as cityRideAvailable', async () => {
    get.mockResolvedValue({ data: { scope: 'in_city', cityId: 1, cityName: 'Bhubaneswar', city_ride_available: true } })
    expect(await fetchClassifyTrip(1, 2, 3, 4)).toEqual({ scope: 'in_city', cityId: 1, cityName: 'Bhubaneswar', cityRideAvailable: true })
  })

  it('an older server sends no hint: the field is absent, so City ride is treated as off', async () => {
    get.mockResolvedValue({ data: { scope: 'in_city', cityId: 1, cityName: 'Bhubaneswar' } })
    const c = await fetchClassifyTrip(1, 2, 3, 4)
    expect(c).toEqual({ scope: 'in_city', cityId: 1, cityName: 'Bhubaneswar' })
  })

  it('outstation stays outstation, and a failed call is null', async () => {
    get.mockResolvedValue({ data: { scope: 'outstation', cityId: null, cityName: null, city_ride_available: false } })
    expect(await fetchClassifyTrip(1, 2, 3, 4)).toEqual({ scope: 'outstation' })
    get.mockRejectedValue(new Error('offline'))
    expect(await fetchClassifyTrip(1, 2, 3, 4)).toBeNull()
  })
})

describe('trip mode on the wire is sent only for a city ride', () => {
  beforeEach(() => { vi.clearAllMocks(); post.mockResolvedValue({ data: {} }) })

  it('the fare estimate', async () => {
    await fetchFareEstimate({ categoryId: 2, rideType: 'one_way', distanceKm: 5, durationMin: 10, tripMode: 'city' })
    expect(post.mock.calls[0]![1]).toMatchObject({ trip_mode: 'city' })
    await fetchFareEstimate({ categoryId: 2, rideType: 'one_way', distanceKm: 5, durationMin: 10 })
    expect(post.mock.calls[1]![1]).not.toHaveProperty('trip_mode')
    await fetchFareEstimate({ categoryId: 2, rideType: 'one_way', distanceKm: 5, durationMin: 10, tripMode: 'standard' })
    expect(post.mock.calls[2]![1]).not.toHaveProperty('trip_mode')
  })

  it('the offers preview', async () => {
    const base = { categoryId: 2, rideType: 'one_way' as const, distanceKm: 5, durationMin: 10, paymentChannel: 'cash' as const }
    await previewOffer({ ...base, tripMode: 'city' })
    expect(post.mock.calls[0]![1]).toMatchObject({ trip_mode: 'city' })
    await previewOffer(base)
    expect(post.mock.calls[1]![1]).not.toHaveProperty('trip_mode')
  })

  it('the booking carries tripMode as given', async () => {
    await createBooking({ categoryId: 2, rideType: 'one_way', originLat: 1, originLng: 2, destinationLat: 3, destinationLng: 4, distanceKm: 5, durationMin: 6, tripMode: 'city' })
    expect(post.mock.calls[0]![1]).toMatchObject({ tripMode: 'city' })
  })
})

describe('booking draft store: trip mode', () => {
  beforeEach(() => useBookingDraftStore.getState().reset())

  it('is standard by default, set by the City Ride tile, and cleared by any other ride type or a reset', () => {
    const s = () => useBookingDraftStore.getState()
    expect(s().tripMode).toBe('standard')
    s().setRideType('one_way', true, 'city')
    expect(s().tripMode).toBe('city')
    s().setRideType('rental', true)
    expect(s().tripMode).toBe('standard')
    s().setRideType('one_way', true, 'city')
    s().reset()
    expect(s().tripMode).toBe('standard')
  })
})
