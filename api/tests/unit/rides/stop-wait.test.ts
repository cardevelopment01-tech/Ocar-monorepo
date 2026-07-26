import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  createRide:             vi.fn(),
  logStatusHistory:       vi.fn(),
  createRideAssignment:   vi.fn(),
  getActiveRideIdForUser: vi.fn(),
  insertRideStops:        vi.fn(),
  getRideById:            vi.fn(),
  markStopStatus:         vi.fn(),
  getRideRatePerMin:      vi.fn(),
}))
vi.mock('@/modules/pricing/pricing.service', () => ({
  getFareEstimate: vi.fn(),
  clampTripHours:  vi.fn((_t: string, h: number | undefined) => h ?? 0),
}))
vi.mock('@/modules/pricing/pricing.repository', () => ({ getStopCharge: vi.fn() }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { broadcastNewRide: vi.fn(), notifyUserRideUpdate: vi.fn(), sendStopUpdated: vi.fn() },
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

import * as repo    from '@/modules/rides/rides.repository'
import * as pricing from '@/modules/pricing/pricing.service'
import { getStopCharge } from '@/modules/pricing/pricing.repository'
import { pool }     from '@/db/client'
import { createBooking, markStopStatus } from '@/modules/rides/rides.service'
import { STOP_FREE_WAIT_MINUTES } from '@/constants/limits'

const USER_ID = BigInt(42)
// A stop at Cuttack — well over the 100m dedupe radius from both anchors.
const CUTTACK = { lat: 20.4625, lng: 85.8830, address: 'Cuttack' }
const BASE = {
  categoryId: 2,
  originLat: 20.2961, originLng: 85.8245, originAddress: 'BBSR',
  destinationLat: 19.8010, destinationLng: 85.8210, destinationAddress: 'Puri',
  distanceKm: 65, durationMin: 90, originCityId: 1,
}
const FARE = { rate_card_id: 1, surge_event_id: null, surge_multiplier: 1,
  breakdown: { base_fare: 0, distance_fare: 650, time_fare: 108, stop_fare: 0,
    hour_surcharge: 0, overage_fare: 0, surge_fare: 0, subtotal: 758, total: 758 } }
const RIDE = { id: BigInt(101), user_id: USER_ID, status: 'requested',
  category_id: BigInt(2), origin_lat: 20.2961, origin_lng: 85.8245, dest_lat: 19.8, dest_lng: 85.82 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(pricing.getFareEstimate).mockResolvedValue(FARE as never)
  vi.mocked(repo.createRide).mockResolvedValue(RIDE as never)
  vi.mocked(repo.insertRideStops).mockResolvedValue([] as never)
  vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
  vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
  vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue(null)
  vi.mocked(getStopCharge).mockResolvedValue(25 as never)
})

describe('createBooking — stops are not double-charged on one-way', () => {
  it('one-way stops carry NO flat per-stop fee (priced via detour distance)', async () => {
    await createBooking(USER_ID, { ...BASE, rideType: 'one_way', stops: [CUTTACK] })

    // fareStopCount must be 0 for one-way — the flat fee would double-charge the detour.
    expect(vi.mocked(pricing.getFareEstimate).mock.calls[0]![0].stop_count).toBe(0)
    expect(getStopCharge).not.toHaveBeenCalled()
    const insertedStops = vi.mocked(repo.insertRideStops).mock.calls[0]![1]
    expect(insertedStops[0]!.chargeApplied).toBe(0)
  })

  it('round-trip stops DO carry the flat per-stop fee', async () => {
    await createBooking(USER_ID, { ...BASE, rideType: 'round_trip', tripHours: 4, stops: [CUTTACK] })

    expect(vi.mocked(pricing.getFareEstimate).mock.calls[0]![0].stop_count).toBe(1)
    expect(getStopCharge).toHaveBeenCalled()
    const insertedStops = vi.mocked(repo.insertRideStops).mock.calls[0]![1]
    expect(insertedStops[0]!.chargeApplied).toBe(25)
  })
})

describe('markStopStatus — wait is metered only on one-way', () => {
  const DRIVER_ID = BigInt(7)
  const RIDE_ID   = BigInt(101)
  const inProgress = (rideType: string) => ({
    id: RIDE_ID, driver_id: DRIVER_ID, status: 'in_progress', ride_type: rideType,
  })
  const STOP = { id: BigInt(1), sequence: 1, status: 'reached', reached_at: 't', arrived_at: 't0', wait_charge: '0' }

  beforeEach(() => {
    vi.mocked(repo.markStopStatus).mockResolvedValue(STOP as never)
    vi.mocked(repo.getRideRatePerMin).mockResolvedValue(2 as never)
  })

  it('one-way reached passes the free window + the ride’s per-minute rate', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(inProgress('one_way') as never)
    await markStopStatus(DRIVER_ID, RIDE_ID, 1, 'reached')

    expect(repo.getRideRatePerMin).toHaveBeenCalledWith(RIDE_ID)
    expect(repo.markStopStatus).toHaveBeenCalledWith(RIDE_ID, 1, 'reached', 2, STOP_FREE_WAIT_MINUTES)
  })

  it('round-trip reached meters no wait (rate 0, free 0) — wait is in the hours package', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(inProgress('round_trip') as never)
    await markStopStatus(DRIVER_ID, RIDE_ID, 1, 'reached')

    expect(repo.getRideRatePerMin).not.toHaveBeenCalled()
    expect(repo.markStopStatus).toHaveBeenCalledWith(RIDE_ID, 1, 'reached', 0, 0)
  })
})
