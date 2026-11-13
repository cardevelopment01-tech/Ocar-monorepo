import { describe, it, expect, vi, beforeEach } from 'vitest'

// Old rider and web builds never send tripMode. Whatever the city_rides_enabled switch says, they must get exactly the answers
// they got before city rides existed (plan Review Focus 2).

const bookingClient = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })), release: vi.fn() }))
const world = vi.hoisted(() => ({ flagOn: false }))

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
vi.mock('@/db/client', () => ({
  pool: {
    connect: vi.fn(async () => bookingClient),
    query: vi.fn((sql: string) =>
      sql.includes('boundary')
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
const SHORT_HOP = {
  categoryId: 2, rideType: 'one_way', originLat: 20.2961, originLng: 85.8245, originAddress: 'BBSR A',
  destinationLat: 20.3000, destinationLng: 85.8300, destinationAddress: 'BBSR B', distanceKm: 3, durationMin: 10, originCityId: 1,
}
const CUTTACK_TRIP = { ...SHORT_HOP, destinationLat: 20.4625, destinationLng: 85.8828, destinationAddress: 'Cuttack', distanceKm: 30, durationMin: 45 }

describe.each([[false], [true]])('a request with no tripMode, switch on = %s', (flagOn) => {
  beforeEach(() => {
    vi.clearAllMocks()
    world.flagOn = flagOn
    vi.mocked(pricing.getFareEstimate).mockResolvedValue(FARE as never)
    vi.mocked(repo.createRide).mockResolvedValue({ id: BigInt(101), user_id: USER_ID, status: 'requested', ride_type: 'one_way' } as never)
    vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue(null)
  })

  it('still gets the exact in-city refusal for a short hop', async () => {
    await expect(createBooking(USER_ID, SHORT_HOP as never)).rejects.toMatchObject({
      httpStatus: 422,
      message: 'This trip stays within Bhubaneswar — book an hourly rental package instead',
    })
    expect(repo.createRide).not.toHaveBeenCalled()
  })

  it('still books a long in-region trip as a standard one-way, quoted without a trip mode', async () => {
    await createBooking(USER_ID, CUTTACK_TRIP as never)
    expect(vi.mocked(pricing.getFareEstimate).mock.calls[0]![0]).not.toHaveProperty('trip_mode', 'city')
    expect(vi.mocked(repo.createRide).mock.calls[0]![0]).not.toHaveProperty('tripMode', 'city')
  })
})
