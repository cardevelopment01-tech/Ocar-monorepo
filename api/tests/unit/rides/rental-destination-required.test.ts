import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  createRide:             vi.fn(),
  logStatusHistory:       vi.fn(),
  createRideAssignment:   vi.fn(),
  getActiveRideIdForUser: vi.fn(),
}))

vi.mock('@/modules/pricing/pricing.service', () => ({
  getFareEstimate: vi.fn(),
  clampTripHours:  vi.fn((_rideType: string, hours: number | undefined) => hours ?? 0),
}))

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { broadcastNewRide: vi.fn(), notifyUserRideUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))

vi.mock('@/jobs/queues', () => ({
  queues: {
    notifications: { add: vi.fn().mockResolvedValue(undefined) },
    dispatch: { add: vi.fn().mockResolvedValue(undefined) },
  },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications', DISPATCH: 'dispatch' },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@/lib/otp', () => ({ generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'hashed') }))

vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn(), deductCommission: vi.fn(), creditCashback: vi.fn(),
}))

import * as repo    from '@/modules/rides/rides.repository'
import * as pricing from '@/modules/pricing/pricing.service'
import { pool }      from '@/db/client'
import { createBooking } from '@/modules/rides/rides.service'

const USER_ID = BigInt(42)

const RENTAL_REQUEST = {
  categoryId:   2,
  rideType:     'rental' as const,
  originLat:    20.2961,
  originLng:    85.8245,
  originAddress: 'Bhubaneswar',
  distanceKm:   0,
  durationMin:  0,
  rentalPackageId: 1,
  originCityId: 1,
}

const FARE_STUB = {
  rate_card_id: 1, surge_event_id: null, surge_multiplier: 1.0, rental_hours: 4,
  breakdown: { base_fare: 500, distance_fare: 0, time_fare: 0, stop_fare: 0, hour_surcharge: 0, overage_fare: 0, surge_fare: 0, subtotal: 500, total: 500 },
}

describe('createBooking — rental destination required', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pricing.getFareEstimate).mockResolvedValue(FARE_STUB as never)
    vi.mocked(repo.createRide).mockResolvedValue({ id: BigInt(101), user_id: USER_ID, status: 'requested', ride_type: 'rental' } as never)
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
    vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue(null)
  })

  it('rejects a rental booking with no destination', async () => {
    await expect(createBooking(USER_ID, { ...RENTAL_REQUEST })).rejects.toThrow(/drop-off/)
    expect(repo.createRide).not.toHaveBeenCalled()
  })

  it('accepts a rental booking with a destination', async () => {
    await createBooking(USER_ID, {
      ...RENTAL_REQUEST,
      destinationLat: 20.30,
      destinationLng: 85.83,
      destinationAddress: 'Patia',
    })
    expect(repo.createRide).toHaveBeenCalled()
  })

  it('does not require a destination for one_way rides', async () => {
    await createBooking(USER_ID, {
      ...RENTAL_REQUEST,
      rideType: 'one_way',
      destinationLat: undefined,
      destinationLng: undefined,
    })
    expect(repo.createRide).toHaveBeenCalled()
  })
})
