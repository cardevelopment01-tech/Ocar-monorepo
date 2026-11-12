import { describe, it, expect, vi, beforeEach } from 'vitest'

// City ride bookings (plan Task 6, owner decisions D3 = no distance cap, D8 = three modes). A request without tripMode must
// behave exactly as before; legacy-client-compat.test.ts pins that side.

const bookingClient = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })), release: vi.fn() }))
const world = vi.hoisted(() => ({ inCity: true, flagOn: true }))

vi.mock('@/modules/rides/rides.repository', () => ({
  insertFareSnapshot: vi.fn(), insertRideStops: vi.fn(), createRide: vi.fn(), logStatusHistory: vi.fn(),
  createRideAssignment: vi.fn(), getActiveRideIdForUser: vi.fn(),
}))
vi.mock('@/modules/pricing/pricing.service', () => ({
  getFareEstimate: vi.fn(),
  clampTripHours: vi.fn((_t: string, h: number | undefined) => h ?? 0),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { broadcastNewRide: vi.fn(), notifyUserRideUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn().mockResolvedValue(undefined) }, dispatch: { add: vi.fn().mockResolvedValue(undefined) } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications', DISPATCH: 'dispatch' },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/lib/otp', () => ({ generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'h') }))
vi.mock('@/modules/payments/payments.service', () => ({ createPaymentRecord: vi.fn(), deductCommission: vi.fn(), creditCashback: vi.fn() }))
vi.mock('@/lib/system-config', () => ({
  getConfigValue: vi.fn(async (key: string, fallback: string) => (key === 'city_rides_enabled' ? (world.flagOn ? 'true' : 'false') : fallback)),
}))
// Any query mentioning a boundary is findContainingCity: in the merged Bhubaneswar / Khordha / Cuttack region unless inCity is off.
vi.mock('@/db/client', () => ({
  pool: {
    connect: vi.fn(async () => bookingClient),
    query: vi.fn((sql: string) =>
      sql.includes('boundary') && world.inCity
        ? Promise.resolve({ rows: [{ id: 1, name: 'Bhubaneswar' }], rowCount: 1 })
        : Promise.resolve({ rows: [], rowCount: 0 })
    ),
  },
}))

import * as repo from '@/modules/rides/rides.repository'
import * as pricing from '@/modules/pricing/pricing.service'
import { createBooking } from '@/modules/rides/rides.service'

const USER_ID = BigInt(42)
const FARE = { rate_card_id: 1, surge_event_id: null, surge_multiplier: 1, charge_per_stop: 0,
  breakdown: { base_fare: 0, distance_fare: 0, time_fare: 0, stop_fare: 0, hour_surcharge: 0, overage_fare: 0, surge_fare: 0, subtotal: 0, total: 0 } }
const RIDE = { id: BigInt(101), user_id: USER_ID, status: 'requested', ride_type: 'one_way' }

const CUTTACK_TRIP = { // about 28 km, both ends inside the merged region
  categoryId: 2, rideType: 'one_way', originLat: 20.2961, originLng: 85.8245, originAddress: 'Bhubaneswar',
  destinationLat: 20.4625, destinationLng: 85.8828, destinationAddress: 'Cuttack', distanceKm: 30, durationMin: 45, originCityId: 1,
}
const SHORT_HOP = {
  categoryId: 2, rideType: 'one_way', originLat: 20.2961, originLng: 85.8245, originAddress: 'BBSR A',
  destinationLat: 20.3000, destinationLng: 85.8300, destinationAddress: 'BBSR B', distanceKm: 3, durationMin: 10, originCityId: 1,
}

const book = (over: Record<string, unknown>) => createBooking(USER_ID, { ...CUTTACK_TRIP, ...over } as never)

describe('createBooking: tripMode "city"', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    world.inCity = true
    world.flagOn = true
    vi.mocked(pricing.getFareEstimate).mockResolvedValue(FARE as never)
    vi.mocked(repo.createRide).mockResolvedValue(RIDE as never)
    vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue(null)
  })

  it('books Bhubaneswar to Cuttack (about 28 km inside the merged region) as a city ride: quoted on the city card, stored as city', async () => {
    await book({ tripMode: 'city' })
    expect(vi.mocked(pricing.getFareEstimate).mock.calls[0]![0]).toMatchObject({ ride_type: 'one_way', trip_mode: 'city' })
    expect(vi.mocked(repo.createRide).mock.calls[0]![0]).toMatchObject({ rideType: 'one_way', tripMode: 'city' })
  })

  it('books a short in-city hop as a city ride (no "book an hourly rental" block)', async () => {
    await book({ ...SHORT_HOP, tripMode: 'city' })
    expect(repo.createRide).toHaveBeenCalled()
  })

  it('is refused with CITY_RIDE_DISABLED while the switch is off', async () => {
    world.flagOn = false
    await expect(book({ tripMode: 'city' })).rejects.toMatchObject({ httpStatus: 422, appCode: 'CITY_RIDE_DISABLED' })
    expect(repo.createRide).not.toHaveBeenCalled()
  })

  it('is refused with CITY_RIDE_NOT_IN_CITY for a trip that leaves the region', async () => {
    world.inCity = false
    await expect(book({ tripMode: 'city' })).rejects.toMatchObject({ httpStatus: 422, appCode: 'CITY_RIDE_NOT_IN_CITY' })
    expect(repo.createRide).not.toHaveBeenCalled()
  })

  it('is refused for a round trip, a return cab, or a booking with no drop', async () => {
    await expect(book({ tripMode: 'city', rideType: 'round_trip' })).rejects.toMatchObject({ httpStatus: 422 })
    await expect(book({ tripMode: 'city', isReturnCab: true })).rejects.toMatchObject({ httpStatus: 422 })
    await expect(book({ tripMode: 'city', destinationLat: undefined, destinationLng: undefined })).rejects.toMatchObject({ httpStatus: 422 })
    expect(repo.createRide).not.toHaveBeenCalled()
  })

  it('allows three stops and refuses a fourth', async () => {
    const stop = (i: number) => ({ lat: 20.30 + i * 0.01, lng: 85.83 + i * 0.01, address: `S${i}` })
    await book({ tripMode: 'city', stops: [stop(1), stop(2), stop(3)] })
    expect(repo.createRide).toHaveBeenCalledTimes(1)
    await expect(book({ tripMode: 'city', stops: [stop(1), stop(2), stop(3), stop(4)] })).rejects.toMatchObject({ httpStatus: 422 })
  })

  it('checks the city rules once: one trip classification and one read of the switch per booking', async () => {
    const { pool } = await import('@/db/client')
    const { getConfigValue } = await import('@/lib/system-config')
    vi.mocked(pool.query).mockClear()
    vi.mocked(getConfigValue).mockClear()
    await book({ tripMode: 'city' })
    const classifications = vi.mocked(pool.query).mock.calls.filter((c) => String(c[0]).includes('boundary'))
    expect(classifications).toHaveLength(1)
    const flagReads = vi.mocked(getConfigValue).mock.calls.filter((c) => c[0] === 'city_rides_enabled')
    expect(flagReads).toHaveLength(1)
  })

  it('refuses an unknown tripMode instead of treating it as standard', async () => {
    await expect(book({ tripMode: 'bogus' })).rejects.toMatchObject({ httpStatus: 422 })
  })
})
