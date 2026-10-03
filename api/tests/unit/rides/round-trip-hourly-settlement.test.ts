import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// End-of-trip settlement for round trips quoted under pricing_version 2 (hourly window).
// The legacy per-day reconcile is pinned by completion-payment-branch.test.ts (untouched).

vi.mock('@/db/client', () => ({
  pool: { query: vi.fn() },
  withTransaction: vi.fn((cb: (client: { query: ReturnType<typeof vi.fn> }) => unknown) =>
    cb({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) })
  ),
}))
vi.mock('@/db/redis', () => ({ client: { del: vi.fn() } }))
vi.mock('@/lib/otp', () => ({
  generateOtp: vi.fn(() => '1234'),
  hashOtp: vi.fn(() => 'h'),
  checkRideOtpAttempts: vi.fn().mockResolvedValue(1),
  clearRideOtpAttempts: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn(), broadcastNewRide: vi.fn(), notifyUserRideUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn().mockResolvedValue(undefined) }, dispatch: { add: vi.fn().mockResolvedValue(undefined) } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications', DISPATCH: 'dispatch' },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById:              vi.fn(),
  getRideForDriverAction:   vi.fn(),
  getRideCoreById:          vi.fn(),
  getRideStops:             vi.fn().mockResolvedValue([]),
  updateRideStatus:         vi.fn(),
  updateRideStatusCAS:      vi.fn(),
  logStatusHistory:         vi.fn(),
  getStopWaitTotal:         vi.fn().mockResolvedValue(0),
  getGpsTrackedDistanceKm:  vi.fn().mockResolvedValue(null),
  flagRideForReview:        vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord:   vi.fn().mockResolvedValue(undefined),
  deductCommission:      vi.fn().mockResolvedValue(undefined),
  creditCashback:        vi.fn().mockResolvedValue(undefined),
  confirmRidePayment:    vi.fn().mockResolvedValue(true),
  payFromUserWallet:     vi.fn().mockResolvedValue(true),
  createRidePaymentOrder: vi.fn().mockResolvedValue({ orderId: 'order_XYZ', key: 'k', amount: 500 }),
}))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('true') }))

import * as repo from '@/modules/rides/rides.repository'
import { pool }  from '@/db/client'
import { verifyEndOTP } from '@/modules/rides/rides.service'

const flush = () => new Promise(r => setTimeout(r, 0))
const NOW = new Date('2026-10-01T12:00:00Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

// 6h booked, 56 km one-way (112 km total) at Rs 10/km, hour_rate 18:
// 1120 + 6 x 18 = 1228 with no surge and no stops.
const V2_SNAP = {
  surge_multiplier: '1', stop_fare: '0', stop_count: 0, is_return_cab: false,
  estimated_km: '56', trip_hours: '6', pricing_version: 2, waiting_fare: '108',
  rate_per_km: '10', rate_per_min: '1.2', min_fare: '80', return_rate_per_km: null,
  hour_rate: '18', km_per_day: '250', driver_allowance_per_day: '300',
}

let updateParams: unknown[] | undefined

function setup(startedMinutesAgo: number, snap: Record<string, unknown>, opts: { endMetres?: number } = {}) {
  vi.mocked(repo.getRideById).mockResolvedValue({
    id: BigInt(101), user_id: 42, driver_id: 9, status: 'in_progress',
    ride_type: 'round_trip', end_otp_hash: 'h', payment_channel: 'cash',
    origin_lat: 20.3, origin_lng: 85.8, user_phone: null,
    started_at: minutesAgo(startedMinutesAgo),
  } as never)
  updateParams = undefined
  vi.mocked(pool.query).mockImplementation(((sql: string, params?: unknown[]) => {
    if (/ST_Distance/.test(sql)) return Promise.resolve({ rows: [{ metres: String(opts.endMetres ?? 0) }], rowCount: 1 })
    if (/FROM fare_snapshots fs\s+JOIN rate_cards/.test(sql)) return Promise.resolve({ rows: [snap], rowCount: 1 })
    if (/UPDATE fare_snapshots/.test(sql) && /total_final\s*=\s*COALESCE/.test(sql)) {
      updateParams = params
      return Promise.resolve({ rows: [], rowCount: 1 })
    }
    return Promise.resolve({ rows: [{ amount: '500.00' }], rowCount: 1 })
  }) as never)
}

describe('verifyEndOTP, round trip quoted under pricing_version 2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] }) // flush() relies on the real setTimeout
    vi.setSystemTime(NOW)
    vi.mocked(repo.updateRideStatus).mockResolvedValue(undefined as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
    vi.mocked(repo.getRideForDriverAction).mockImplementation(
      ((id: bigint) => vi.mocked(repo.getRideById)(id)) as never)
    vi.mocked(repo.getRideCoreById).mockImplementation(
      ((id: bigint) => vi.mocked(repo.getRideById)(id)) as never)
  })
  afterEach(() => vi.useRealTimers())

  it('on time: final equals the quote, no overtime, even when the app reports no actuals (driver-mobile sends only the code)', async () => {
    setup(300, V2_SNAP) // 5h of 6h booked
    await verifyEndOTP(BigInt(9), BigInt(101), '1234')
    await flush()
    const [, , , totalFinal, , , overtimeMin, overtimeFare] = updateParams!
    expect(totalFinal).toBe(1228)
    expect(overtimeMin).toBe(0)
    expect(overtimeFare).toBe(0)
    expect(repo.flagRideForReview).not.toHaveBeenCalled()
  })

  it('finishing early still pays the full booked hours (no refund)', async () => {
    setup(30, V2_SNAP)
    await verifyEndOTP(BigInt(9), BigInt(101), '1234')
    await flush()
    expect(updateParams![3]).toBe(1228)
  })

  it('inside the 5-minute grace: no overtime', async () => {
    setup(364, V2_SNAP)
    await verifyEndOTP(BigInt(9), BigInt(101), '1234')
    await flush()
    expect(updateParams![3]).toBe(1228)
    expect(updateParams![6]).toBe(0)
  })

  it('normal completion past the grace adds per-minute overtime to the quote', async () => {
    setup(380, V2_SNAP) // 15 min past the grace -> 15 x 18/60 = 4.5, whole rupees 5
    await verifyEndOTP(BigInt(9), BigInt(101), '1234')
    await flush()
    expect(updateParams![3]).toBe(1233)
    expect(updateParams![6]).toBe(15)
    expect(updateParams![7]).toBe(5)
  })

  it('extra km beyond the quoted route add to the fare; fewer km never lower it', async () => {
    setup(300, V2_SNAP)
    vi.mocked(repo.getGpsTrackedDistanceKm).mockResolvedValueOnce(130) // 18 km over the 112 quoted
    await verifyEndOTP(BigInt(9), BigInt(101), '1234')
    await flush()
    expect(updateParams![3]).toBe(1408) // 130 x 10 + 108

    setup(300, V2_SNAP)
    vi.mocked(repo.getGpsTrackedDistanceKm).mockResolvedValueOnce(60) // fewer than quoted
    await verifyEndOTP(BigInt(9), BigInt(101), '1234')
    await flush()
    expect(updateParams![3]).toBe(1228)
  })

  it('over 60 billed minutes: billed in full and flagged for ops', async () => {
    setup(6 * 60 + 5 + 61, V2_SNAP)
    await verifyEndOTP(BigInt(9), BigInt(101), '1234')
    await flush()
    expect(updateParams![6]).toBe(61)
    expect(updateParams![3]).toBe(1246) // 1228 + round(61 x 18/60)
    expect(repo.flagRideForReview).toHaveBeenCalledWith(BigInt(101), expect.stringMatching(/over 60 minutes/i))
  })

  it('early termination (ended > 500 m from origin) keeps the waiting fare on top of the one_way bill', async () => {
    setup(120, V2_SNAP, { endMetres: 5000 })
    await verifyEndOTP(BigInt(9), BigInt(101), '1234', 5, 40, 20.34, 85.84)
    await flush()
    // one_way: 10 km x 10 + 50 min x 1.2 = 160, plus the 6 x 18 = 108 booked hours
    expect(updateParams![3]).toBe(268)
    expect(updateParams![4]).toBe(5)
  })

  it('a pricing_version 1 ride is untouched: no overtime even far past its hours', async () => {
    setup(600, { ...V2_SNAP, pricing_version: 1 })
    await verifyEndOTP(BigInt(9), BigInt(101), '1234', 400, 600)
    await flush()
    expect(updateParams![6]).toBeNull()
    expect(updateParams![7]).toBe(0)
    expect(repo.flagRideForReview).not.toHaveBeenCalledWith(BigInt(101), expect.stringMatching(/overtime/i))
  })

  it('a booking over 24h keeps the per-day recount and gets no overtime', async () => {
    setup(31 * 60, { ...V2_SNAP, trip_hours: '30', waiting_fare: '0' })
    await verifyEndOTP(BigInt(9), BigInt(101), '1234', 400, 31 * 60)
    await flush()
    expect(updateParams![6]).toBeNull()
  })
})
