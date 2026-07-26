import { describe, it, expect, vi, beforeEach } from 'vitest'

// Khorda/Bhubaneswar/Cuttack now share one merged city boundary (055_merge_khorda_bbsr_ctc_boundary.sql),
// so classifyTrip() alone can no longer tell a genuine Bhubaneswar<->Cuttack intercity trip apart from a
// short in-city hop — both land inside the same boundary row. rides.service.ts now also gates the
// "book an hourly rental instead" block on trip distance (IN_CITY_MAX_TRIP_DISTANCE_METRES). This test
// pins that gate: short same-boundary trips are still blocked, long ones (Bhubaneswar<->Cuttack) are not.

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
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn(), deductCommission: vi.fn(), creditCashback: vi.fn(),
}))

// Both Bhubaneswar and Cuttack rows now carry the same merged boundary, so any query
// containing "boundary" (i.e. findContainingCity) reports the trip as in that city.
vi.mock('@/db/client', () => ({
  pool: {
    query: vi.fn((sql: string) =>
      sql.includes('boundary')
        ? Promise.resolve({ rows: [{ id: 1, name: 'Bhubaneswar' }], rowCount: 1 })
        : Promise.resolve({ rows: [], rowCount: 0 })
    ),
  },
}))

import * as repo    from '@/modules/rides/rides.repository'
import * as pricing from '@/modules/pricing/pricing.service'
import { createBooking } from '@/modules/rides/rides.service'

const USER_ID = BigInt(42)
const FARE = { rate_card_id: 1, surge_event_id: null, surge_multiplier: 1,
  breakdown: { base_fare: 0, distance_fare: 0, time_fare: 0, stop_fare: 0,
    hour_surcharge: 0, overage_fare: 0, surge_fare: 0, subtotal: 0, total: 0 } }
const RIDE = { id: BigInt(101), user_id: USER_ID, status: 'requested', ride_type: 'one_way' }

describe('in-city boundary gate (Khorda/Bhubaneswar/Cuttack merge)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pricing.getFareEstimate).mockResolvedValue(FARE as never)
    vi.mocked(repo.createRide).mockResolvedValue(RIDE as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
    vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue(null)
  })

  it('blocks a short same-boundary hop as a would-be City Ride', async () => {
    await expect(createBooking(USER_ID, {
      categoryId: 2, rideType: 'one_way',
      originLat: 20.2961, originLng: 85.8245, originAddress: 'BBSR A',
      destinationLat: 20.3000, destinationLng: 85.8300, destinationAddress: 'BBSR B',
      distanceKm: 3, durationMin: 10, originCityId: 1,
    } as never)).rejects.toThrow('book an hourly rental package instead')
  })

  it('allows a genuine Bhubaneswar<->Cuttack trip despite the shared boundary', async () => {
    await createBooking(USER_ID, {
      categoryId: 2, rideType: 'one_way',
      originLat: 20.2961, originLng: 85.8245, originAddress: 'Bhubaneswar',
      destinationLat: 20.4625, destinationLng: 85.8828, destinationAddress: 'Cuttack',
      distanceKm: 30, durationMin: 45, originCityId: 1,
    } as never)
    expect(repo.createRide).toHaveBeenCalled()
  })
})
