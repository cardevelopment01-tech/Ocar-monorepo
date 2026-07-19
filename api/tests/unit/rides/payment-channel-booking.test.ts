import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  createRide:            vi.fn(),
  logStatusHistory:      vi.fn(),
  createRideAssignment:  vi.fn(),
  getActiveRideIdForUser: vi.fn(),
}))
vi.mock('@/modules/pricing/pricing.service', () => ({
  getFareEstimate: vi.fn(),
  clampTripHours:  vi.fn((_t: string, h: number | undefined) => h ?? 0),
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { broadcastNewRide: vi.fn(), notifyUserRideUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn().mockResolvedValue(undefined) } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications' },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/lib/otp', () => ({ generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'h') }))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn(), deductCommission: vi.fn(), creditCashback: vi.fn(),
}))

import * as repo    from '@/modules/rides/rides.repository'
import * as pricing from '@/modules/pricing/pricing.service'
import { pool }     from '@/db/client'
import { createBooking } from '@/modules/rides/rides.service'

const USER_ID = BigInt(42)
const BASE = {
  categoryId: 2, rideType: 'one_way' as const,
  originLat: 20.2961, originLng: 85.8245, originAddress: 'BBSR',
  destinationLat: 19.8010, destinationLng: 85.8210, destinationAddress: 'Puri',
  distanceKm: 65, durationMin: 90, originCityId: 1,
}
const FARE = { rate_card_id: 1, surge_event_id: null, surge_multiplier: 1,
  breakdown: { base_fare: 0, distance_fare: 650, time_fare: 108, stop_fare: 0,
    hour_surcharge: 0, overage_fare: 0, surge_fare: 0, subtotal: 758, total: 758 } }
const RIDE = { id: BigInt(101), user_id: USER_ID, status: 'requested', ride_type: 'one_way',
  category_id: BigInt(2), origin_lat: 20.2961, origin_lng: 85.8245, dest_lat: 19.8, dest_lng: 85.82 }

describe('createBooking — payment_channel passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pricing.getFareEstimate).mockResolvedValue(FARE as never)
    vi.mocked(repo.createRide).mockResolvedValue(RIDE as never)
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
    vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue(null)
  })

  it('passes an explicit paymentChannel to createRide', async () => {
    await createBooking(USER_ID, { ...BASE, paymentChannel: 'online' })
    const call = vi.mocked(repo.createRide).mock.calls[0]![0]
    expect(call.paymentChannel).toBe('online')
  })

  it('defaults to cash when paymentChannel is omitted', async () => {
    await createBooking(USER_ID, { ...BASE })
    const call = vi.mocked(repo.createRide).mock.calls[0]![0]
    expect(call.paymentChannel).toBe('cash')
  })

  it('passes wallet through', async () => {
    await createBooking(USER_ID, { ...BASE, paymentChannel: 'wallet' })
    const call = vi.mocked(repo.createRide).mock.calls[0]![0]
    expect(call.paymentChannel).toBe('wallet')
  })
})
