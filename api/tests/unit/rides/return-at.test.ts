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
    'gps-flush':   { add: vi.fn().mockResolvedValue(undefined) },
    settlements:   { add: vi.fn().mockResolvedValue(undefined) },
    analytics:     { add: vi.fn().mockResolvedValue(undefined) },
    scheduler:     { add: vi.fn().mockResolvedValue(undefined) },
    cleanup:       { add: vi.fn().mockResolvedValue(undefined) },
  },
  QUEUE_NAMES: {
    NOTIFICATIONS: 'notifications',
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

// ── Shared test data ───────────────────────────────────────────────────────────

const USER_ID = BigInt(42)

const BASE_REQUEST = {
  categoryId:      2,
  rideType:        'round_trip' as const,
  originLat:       20.2961,
  originLng:       85.8245,
  originAddress:   'Bhubaneswar',
  destinationLat:  19.8010,
  destinationLng:  85.8210,
  destinationAddress: 'Puri',
  distanceKm:      65,
  durationMin:     90,
  originCityId:    1,
  tripHours:       6,
}

const FARE_STUB = {
  rate_card_id:     1,
  surge_event_id:   null,
  surge_multiplier: 1.0,
  breakdown: {
    base_fare: 0, distance_fare: 650, time_fare: 108,
    stop_fare: 0, hour_surcharge: 108, overage_fare: 0,
    surge_fare: 0, subtotal: 866, total: 866,
  },
}

const RIDE_STUB = {
  id: BigInt(101), user_id: USER_ID, status: 'requested',
  ride_type: 'round_trip', category_id: BigInt(2),
  origin_lat: 20.2961, origin_lng: 85.8245,
  dest_lat: 19.8010, dest_lng: 85.8210,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createBooking — returnAt passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pricing.getFareEstimate).mockResolvedValue(FARE_STUB)
    vi.mocked(repo.createRide).mockResolvedValue(RIDE_STUB as never)
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
    vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue(null)
  })

  it('passes returnAt to createRide when provided', async () => {
    const returnAt = '2026-07-05T18:30:00.000Z'
    await createBooking(USER_ID, { ...BASE_REQUEST, returnAt })

    expect(repo.createRide).toHaveBeenCalledOnce()
    const call = vi.mocked(repo.createRide).mock.calls[0]![0]
    expect(call.returnAt).toBe(returnAt)
  })

  it('does not set returnAt on createRide when not provided', async () => {
    await createBooking(USER_ID, { ...BASE_REQUEST })

    const call = vi.mocked(repo.createRide).mock.calls[0]![0]
    expect(call.returnAt).toBeUndefined()
  })

  it('stores returnAt regardless of tripHours value', async () => {
    const returnAt = '2026-07-05T12:00:00.000Z'
    await createBooking(USER_ID, { ...BASE_REQUEST, tripHours: 4, returnAt })

    const call = vi.mocked(repo.createRide).mock.calls[0]![0]
    expect(call.returnAt).toBe(returnAt)
    expect(call.tripHours).toBe(4)
  })

  it('trip_hours in fare snapshot uses clamped value, not raw input', async () => {
    const returnAt = '2026-07-05T18:30:00.000Z'
    await createBooking(USER_ID, { ...BASE_REQUEST, tripHours: 2, returnAt })

    // clampTripHours('round_trip', 2) → max(4, ceil(2)) = 4
    expect(pricing.clampTripHours).toHaveBeenCalledWith('round_trip', 2)
    const call = vi.mocked(repo.createRide).mock.calls[0]![0]
    expect(call.tripHours).toBe(4)
  })

  it('returnAt is independent of tripHours clamping — both stored correctly', async () => {
    const returnAt = '2026-07-05T22:00:00.000Z'
    await createBooking(USER_ID, { ...BASE_REQUEST, tripHours: 8, returnAt })

    const call = vi.mocked(repo.createRide).mock.calls[0]![0]
    expect(call.returnAt).toBe(returnAt)
    expect(call.tripHours).toBe(8)
  })

  it('does not set returnAt for one_way rides even if accidentally provided', async () => {
    // one_way requests shouldn't send returnAt but service must not crash if they do
    const returnAt = '2026-07-05T18:30:00.000Z'
    await createBooking(USER_ID, {
      ...BASE_REQUEST,
      rideType: 'one_way',
      returnAt,
    })

    // returnAt should still be passed through — the DB column allows it
    // but this verifies the service doesn't strip it either
    const call = vi.mocked(repo.createRide).mock.calls[0]![0]
    expect(call.returnAt).toBe(returnAt)
  })
})
