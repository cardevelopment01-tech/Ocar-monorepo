import { describe, it, expect, vi, beforeEach } from 'vitest'

const post = vi.fn()
vi.mock('../lib/api', () => ({ default: { post: (...a: unknown[]) => post(...a), get: vi.fn() } }))
vi.mock('../lib/payment-channel', () => ({ getPaymentChannel: () => 'cash' }))

import { rideApi } from '../lib/ride-api'
import { previewOffer } from '../lib/offers-api'

const est = { categoryId: 2, rideType: 'one_way' as const, distanceKm: 5, durationMin: 10 }
const booking = { ...est, originLat: 1, originLng: 2, originAddress: 'A', destinationLat: 3, destinationLng: 4 }

describe('trip mode is sent only for a city ride', () => {
  beforeEach(() => { vi.clearAllMocks(); post.mockResolvedValue({ data: {} }) })

  it('the fare estimate', async () => {
    await rideApi.getEstimate({ ...est, tripMode: 'city' })
    expect(post.mock.calls[0]![1]).toMatchObject({ trip_mode: 'city' })
    await rideApi.getEstimate(est)
    expect(post.mock.calls[1]![1]).not.toHaveProperty('trip_mode')
  })

  it('the booking', async () => {
    await rideApi.createBooking({ ...booking, tripMode: 'city' })
    expect(post.mock.calls[0]![1]).toMatchObject({ tripMode: 'city' })
    await rideApi.createBooking(booking)
    expect(post.mock.calls[1]![1]).not.toHaveProperty('tripMode')
  })

  it('the offers preview', async () => {
    await previewOffer({ ...est, originLat: 1, originLng: 2, tripMode: 'city' })
    expect(post.mock.calls[0]![1]).toMatchObject({ trip_mode: 'city' })
    await previewOffer({ ...est, originLat: 1, originLng: 2 })
    expect(post.mock.calls[1]![1]).not.toHaveProperty('trip_mode')
  })
})
