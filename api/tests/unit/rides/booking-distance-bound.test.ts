import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  createRide:             vi.fn(),
  logStatusHistory:       vi.fn(),
  getActiveRideIdForUser: vi.fn(),
  insertRideStops:        vi.fn(),
}))

vi.mock('@/modules/pricing/pricing.service', () => ({
  getFareEstimate: vi.fn(),
  clampTripHours:  vi.fn((rideType: string, hours: number | undefined) =>
    rideType === 'round_trip' ? Math.max(4, Math.ceil(hours ?? 0)) : (hours ?? 0)
  ),
}))

vi.mock('@/modules/geo/geo.service', () => ({
  findNearestCity: vi.fn(() => null),
  classifyTrip:    vi.fn(() => ({ scope: 'outstation', cityId: null, cityName: null })),
  getRoute:        vi.fn(),
  snapTrailToRoads: vi.fn(),
}))

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { incr: vi.fn(), expire: vi.fn(), del: vi.fn() } }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { broadcastNewRide: vi.fn(), sendRideStatusUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { dispatch: { add: vi.fn().mockResolvedValue({ id: 'j1' }) }, scheduler: { add: vi.fn() } },
  QUEUE_NAMES: { DISPATCH: 'dispatch', SCHEDULER: 'scheduler' },
  gpsFlushQueue: { add: vi.fn() },
}))
vi.mock('@/lib/otp', () => ({ generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'h') }))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn(), deductCommission: vi.fn(), creditCashback: vi.fn(),
}))
vi.mock('@/modules/pricing/pricing.repository', () => ({ getStopCharge: vi.fn(() => 0) }))

import * as repo    from '@/modules/rides/rides.repository'
import * as pricing from '@/modules/pricing/pricing.service'
import * as geo     from '@/modules/geo/geo.service'
import { pool }     from '@/db/client'
import { createBooking } from '@/modules/rides/rides.service'

const USER_ID = BigInt(42)
const BASE = {
  categoryId: 2, rideType: 'one_way' as const,
  originLat: 20.2961, originLng: 85.8245, originAddress: 'BBSR',
  destinationLat: 19.8010, destinationLng: 85.8210, destinationAddress: 'Puri',
  distanceKm: 65, durationMin: 90,
}
const FARE = {
  rate_card_id: 1, surge_event_id: null, surge_multiplier: 1.0,
  breakdown: { base_fare: 0, distance_fare: 650, time_fare: 108, stop_fare: 0, hour_surcharge: 0, surge_fare: 0, total: 758 },
}
const RIDE = { id: BigInt(101), user_id: USER_ID, status: 'requested', ride_type: 'one_way', category_id: BigInt(2) }

describe('createBooking — server-side distance bound', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pricing.getFareEstimate).mockResolvedValue(FARE as never)
    vi.mocked(repo.createRide).mockResolvedValue(RIDE as never)
    vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue(null as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
  })

  it('keeps the client distance when it is within the 15% tolerance band', async () => {
    vi.mocked(geo.getRoute).mockResolvedValue({ distanceKm: 68, durationMin: 95, polyline: '', source: 'google' } as never)
    await createBooking(USER_ID, { ...BASE }) // 65 is within [57.8, 78.2]
    const fareCall = vi.mocked(pricing.getFareEstimate).mock.calls[0]![0]
    expect(fareCall.distance_km).toBe(65)
    expect(fareCall.duration_min).toBe(90)
  })

  it('overwrites a low-balled client distance with the server value', async () => {
    vi.mocked(geo.getRoute).mockResolvedValue({ distanceKm: 65, durationMin: 90, polyline: '', source: 'google' } as never)
    await createBooking(USER_ID, { ...BASE, distanceKm: 30, durationMin: 40 }) // 30 < 55.25 → out of band
    const fareCall = vi.mocked(pricing.getFareEstimate).mock.calls[0]![0]
    expect(fareCall.distance_km).toBe(65)
    expect(fareCall.duration_min).toBe(90)
  })

  it('does NOT overwrite when the server route is a straight-line fallback', async () => {
    vi.mocked(geo.getRoute).mockResolvedValue({ distanceKm: 65, durationMin: 90, polyline: '', source: 'fallback' } as never)
    await createBooking(USER_ID, { ...BASE, distanceKm: 30, durationMin: 40 })
    const fareCall = vi.mocked(pricing.getFareEstimate).mock.calls[0]![0]
    expect(fareCall.distance_km).toBe(30) // fallback is itself untrustworthy → keep client value
  })
})
