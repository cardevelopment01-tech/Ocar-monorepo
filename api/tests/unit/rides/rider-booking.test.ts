import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks must be declared before any imports that trigger the module graph ───

vi.mock('@/modules/rides/rides.repository', () => ({
  createRide:         vi.fn(),
  logStatusHistory:   vi.fn(),
  createRideAssignment: vi.fn(),
  getActiveRideIdForUser: vi.fn(),
}))

vi.mock('@/modules/pricing/pricing.service', () => ({
  getFareEstimate:  vi.fn(),
  clampTripHours:   vi.fn((rideType: string, hours: number | undefined) =>
    rideType === 'round_trip' ? Math.max(4, Math.ceil(hours ?? 0)) : (hours ?? 0)
  ),
}))

vi.mock('@/db/client', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { broadcastNewRide: vi.fn(), notifyUserRideUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))

vi.mock('@/jobs/queues', () => ({
  queues: {
    notifications: { add: vi.fn().mockResolvedValue(undefined) },
    dispatch:      { add: vi.fn().mockResolvedValue(undefined) },
    'gps-flush':   { add: vi.fn().mockResolvedValue(undefined) },
    settlements:   { add: vi.fn().mockResolvedValue(undefined) },
    analytics:     { add: vi.fn().mockResolvedValue(undefined) },
    scheduler:     { add: vi.fn().mockResolvedValue(undefined) },
    cleanup:       { add: vi.fn().mockResolvedValue(undefined) },
  },
  QUEUE_NAMES: {
    NOTIFICATIONS: 'notifications',
    DISPATCH:      'dispatch',
    GPS_FLUSH:     'gps-flush',
    SETTLEMENTS:   'settlements',
    ANALYTICS:     'analytics',
    SCHEDULER:     'scheduler',
    CLEANUP:       'cleanup',
  },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@/lib/otp', () => ({
  generateOtp: vi.fn(() => '123456'),
  hashOtp:     vi.fn(() => 'hashed-otp'),
}))

vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn(),
  deductCommission:    vi.fn(),
  creditCashback:      vi.fn(),
}))

// ── Import after mocks ─────────────────────────────────────────────────────────

import * as repo    from '@/modules/rides/rides.repository'
import * as pricing from '@/modules/pricing/pricing.service'
import { pool }     from '@/db/client'
import { createBooking } from '@/modules/rides/rides.service'

const USER_ID = BigInt(42)

const BASE_REQUEST = {
  categoryId:      2,
  rideType:        'one_way' as const,
  originLat:       20.2961,
  originLng:       85.8245,
  originAddress:   'Bhubaneswar',
  destinationLat:  19.8010,
  destinationLng:  85.8210,
  destinationAddress: 'Puri',
  distanceKm:      65,
  durationMin:     90,
  originCityId:    1,
}

const FARE_STUB = {
  rate_card_id:     1,
  surge_event_id:   null,
  surge_multiplier: 1.0,
  breakdown: {
    base_fare: 0, distance_fare: 650, time_fare: 108,
    stop_fare: 0, hour_surcharge: 0, overage_fare: 0,
    surge_fare: 0, subtotal: 758, total: 758,
  },
}

const RIDE_STUB = {
  id: BigInt(101), user_id: USER_ID, status: 'requested',
  ride_type: 'one_way', category_id: BigInt(2),
  origin_lat: 20.2961, origin_lng: 85.8245,
  dest_lat: 19.8010, dest_lng: 85.8210,
}

describe('createBooking — book-for-someone-else', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pricing.getFareEstimate).mockResolvedValue(FARE_STUB)
    vi.mocked(repo.createRide).mockResolvedValue(RIDE_STUB as never)
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
    vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue(null)
  })

  it('passes riderName/riderPhone through to createRide when provided', async () => {
    await createBooking(USER_ID, {
      ...BASE_REQUEST,
      riderName: '  Priya Das  ',
      riderPhone: '+919876543210',
    })

    const call = vi.mocked(repo.createRide).mock.calls[0]![0]
    expect(call.riderName).toBe('Priya Das')
    expect(call.riderPhone).toBe('+919876543210')
  })

  it('leaves riderName/riderPhone unset when booking for myself', async () => {
    await createBooking(USER_ID, { ...BASE_REQUEST })

    const call = vi.mocked(repo.createRide).mock.calls[0]![0]
    expect(call.riderName).toBeUndefined()
    expect(call.riderPhone).toBeUndefined()
  })

  it('rejects a rider phone that is not a valid Indian mobile number', async () => {
    await expect(createBooking(USER_ID, {
      ...BASE_REQUEST,
      riderName: 'Priya Das',
      riderPhone: '9876543210', // missing +91
    })).rejects.toThrow(/valid Indian mobile number/)

    expect(repo.createRide).not.toHaveBeenCalled()
  })

  it('rejects an empty rider name', async () => {
    await expect(createBooking(USER_ID, {
      ...BASE_REQUEST,
      riderName: '   ',
      riderPhone: '+919876543210',
    })).rejects.toThrow(/Rider name/)

    expect(repo.createRide).not.toHaveBeenCalled()
  })
})
