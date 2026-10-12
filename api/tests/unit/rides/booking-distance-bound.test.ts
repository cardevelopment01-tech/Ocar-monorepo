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

  it('routing degraded to a straight-line fallback: a distance BELOW the physical floor is raised, not believed', async () => {
    vi.mocked(geo.getRoute).mockResolvedValue({ distanceKm: 65, durationMin: 90, polyline: '', source: 'fallback' } as never)
    await createBooking(USER_ID, { ...BASE, distanceKm: 30, durationMin: 40 }) // BBSR→Puri is ~55 km crow-flies
    const fareCall = vi.mocked(pricing.getFareEstimate).mock.calls[0]![0]
    expect(fareCall.distance_km).toBeGreaterThan(55) // can't be shorter than the straight line
    expect(fareCall.distance_km).toBeCloseTo(71.6, 0) // straight line x 1.3 road factor
    expect(fareCall.duration_min).toBeGreaterThanOrEqual(90)
  })

  it('routing degraded: a plausible client distance (at or above the straight line) is kept', async () => {
    vi.mocked(geo.getRoute).mockResolvedValue({ distanceKm: 65, durationMin: 90, polyline: '', source: 'fallback' } as never)
    await createBooking(USER_ID, { ...BASE, distanceKm: 66, durationMin: 85 })
    const fareCall = vi.mocked(pricing.getFareEstimate).mock.calls[0]![0]
    expect(fareCall.distance_km).toBe(66)
  })

  it('routing unavailable (throws): still enforces the straight-line floor', async () => {
    vi.mocked(geo.getRoute).mockRejectedValue(new Error('google down'))
    await createBooking(USER_ID, { ...BASE, distanceKm: 1, durationMin: 2 })
    const fareCall = vi.mocked(pricing.getFareEstimate).mock.calls[0]![0]
    expect(fareCall.distance_km).toBeGreaterThan(55)
  })

  it('a booking WITH a stop is bound too: legs are routed and a low-balled total is replaced by their sum', async () => {
    // Previously any stop disabled the check entirely (one free stop = pay the minimum fare for a long trip).
    vi.mocked(geo.getRoute)
      .mockResolvedValueOnce({ distanceKm: 40, durationMin: 50, polyline: '', source: 'google' } as never)
      .mockResolvedValueOnce({ distanceKm: 30, durationMin: 40, polyline: '', source: 'google' } as never)
    await createBooking(USER_ID, {
      ...BASE, distanceKm: 5, durationMin: 5,
      stops: [{ lat: 20.05, lng: 85.83, address: 'Stop A' }] as never,
    })
    expect(geo.getRoute).toHaveBeenCalledTimes(2) // origin→stop, stop→drop
    const fareCall = vi.mocked(pricing.getFareEstimate).mock.calls[0]![0]
    expect(fareCall.distance_km).toBe(70)
    expect(fareCall.duration_min).toBe(90)
  })

  it('a ROUND-TRIP booking is bound on the direct pickup->drop path only (its stops are a flat fee, so the quote ignores the detour)', async () => {
    vi.mocked(geo.getRoute).mockResolvedValue({ distanceKm: 65, durationMin: 90, polyline: '', source: 'google' } as never)
    await createBooking(USER_ID, {
      ...BASE, rideType: 'round_trip', distanceKm: 65, durationMin: 90, tripHours: 6,
      stops: [{ lat: 20.05, lng: 85.83, address: 'Stop A' }] as never,
    })
    expect(geo.getRoute).toHaveBeenCalledTimes(1) // not origin->stop + stop->drop
    const fareCall = vi.mocked(pricing.getFareEstimate).mock.calls[0]![0]
    expect(fareCall.distance_km).toBe(65) // the rider's quoted distance survives
  })

  it.each([
    ['NaN distance', { distanceKm: NaN }],
    ['negative distance', { distanceKm: -10 }],
    ['absurd distance', { distanceKm: 1e9 }],
    ['zero duration', { durationMin: 0 }],
    ['absurd trip hours', { tripHours: 1e9 }],
  ])('rejects %s with 422 before any fare is computed', async (_name, patch) => {
    await expect(createBooking(USER_ID, { ...BASE, ...patch })).rejects.toMatchObject({ httpStatus: 422 })
    expect(pricing.getFareEstimate).not.toHaveBeenCalled()
    expect(repo.createRide).not.toHaveBeenCalled()
  })
})
