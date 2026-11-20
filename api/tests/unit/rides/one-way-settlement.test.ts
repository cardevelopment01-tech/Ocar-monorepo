import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// A one-way ride (city rides included) is billed on the km and minutes actually driven, held to a band around the estimate.

vi.mock('@/db/client', () => ({
  pool: { query: vi.fn() },
  withTransaction: vi.fn((cb: (client: { query: ReturnType<typeof vi.fn> }) => unknown) =>
    cb({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) })),
}))
vi.mock('@/db/redis', () => ({ client: { del: vi.fn() } }))
vi.mock('@/lib/otp', () => ({
  generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'h'),
  checkRideOtpAttempts: vi.fn().mockResolvedValue(1), clearRideOtpAttempts: vi.fn().mockResolvedValue(undefined),
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
  getRideById: vi.fn(), getRideForDriverAction: vi.fn(), getRideCoreById: vi.fn(),
  getRideStops: vi.fn().mockResolvedValue([]), updateRideStatus: vi.fn(), updateRideStatusCAS: vi.fn(), logStatusHistory: vi.fn(),
  getStopWaitTotal: vi.fn().mockResolvedValue(0), getStopWaitMinutes: vi.fn().mockResolvedValue(0), getGpsTrailForBilling: vi.fn(),
  flagRideForReview: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn().mockResolvedValue(undefined), deductCommission: vi.fn().mockResolvedValue(undefined),
  creditCashback: vi.fn().mockResolvedValue(undefined), confirmRidePayment: vi.fn().mockResolvedValue(true),
  payFromUserWallet: vi.fn().mockResolvedValue(true), createRidePaymentOrder: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/modules/geo/geo.service', async (orig) => ({ ...(await orig<object>()), getRoute: vi.fn() }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('true') }))

import * as repo from '@/modules/rides/rides.repository'
import { pool } from '@/db/client'
import { getRoute } from '@/modules/geo/geo.service'
import { verifyEndOTP } from '@/modules/rides/rides.service'

const flush = () => new Promise(r => setTimeout(r, 0))
const NOW = new Date('2026-10-01T12:00:00Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

// Rs 12/km + Rs 1/min, min fare 50, no base fare, no surge, no stop fees. Quoted at Rs 150.
const SNAP = {
  estimated_km: '10', estimated_min: '20', is_return_cab: false, surge_multiplier: '1', stop_count: 0, stop_fare: '0',
  total_estimated: '150', rate_per_km: '12', rate_per_min: '1', min_fare: '50', base_fare: '0', return_rate_per_km: null,
}

let settleParams: unknown[] | undefined

const trail = (over: Partial<Record<string, unknown>> = {}) =>
  ({ pings: 50, trackedKm: 10, silentMovedSec: 0, gaps: [], bookedKm: 10, ...over }) as never

function setup(gpsKm: number | null, waitTotal = 0, trailOver: Partial<Record<string, unknown>> = {}, waitMinutes = 0) {
  vi.mocked(repo.getRideById).mockResolvedValue({
    id: BigInt(101), user_id: 42, driver_id: 9, status: 'in_progress', ride_type: 'one_way', end_otp_hash: 'h',
    payment_channel: 'cash', origin_lat: 20.3, origin_lng: 85.8, user_phone: null, started_at: minutesAgo(20),
  } as never)
  vi.mocked(repo.getGpsTrailForBilling).mockResolvedValue(trail(gpsKm === null ? { pings: 1 } : { trackedKm: gpsKm, ...trailOver }))
  vi.mocked(repo.getStopWaitTotal).mockResolvedValue(waitTotal)
  vi.mocked(repo.getStopWaitMinutes).mockResolvedValue(waitMinutes)
  settleParams = undefined
  vi.mocked(pool.query).mockImplementation(((sql: string, params?: unknown[]) => {
    if (/FROM fare_snapshots fs\s+JOIN rate_cards/.test(sql)) return Promise.resolve({ rows: [SNAP], rowCount: 1 })
    if (/UPDATE fare_snapshots/.test(sql) && /round\(COALESCE\(\$3/.test(sql)) {
      settleParams = params
      return Promise.resolve({ rows: [], rowCount: 1 })
    }
    return Promise.resolve({ rows: [{ amount: '500.00' }], rowCount: 1 })
  }) as never)
}
const run = async () => { await verifyEndOTP(BigInt(9), BigInt(101), '1234'); await flush() }

describe('verifyEndOTP, one-way ride billed on actuals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.mocked(repo.updateRideStatus).mockResolvedValue(undefined as never)
    vi.mocked(repo.updateRideStatusCAS).mockResolvedValue({ id: 1n } as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
    vi.mocked(repo.getRideForDriverAction).mockImplementation(((id: bigint) => vi.mocked(repo.getRideById)(id)) as never)
    vi.mocked(repo.getRideCoreById).mockImplementation(((id: bigint) => vi.mocked(repo.getRideById)(id)) as never)
  })
  afterEach(() => vi.useRealTimers())

  it('bills the km and minutes driven, not the quote', async () => {
    setup(10) // 10 km x 12 + 20 min x 1 = 140, quote was 150
    await run()
    expect(settleParams).toEqual([BigInt(101), 0, 140, 10, 20])
    expect(repo.flagRideForReview).not.toHaveBeenCalled()
  })

  it('a longer route costs more, up to 25% over the quote, and is flagged', async () => {
    setup(30, 0, { bookedKm: 20 }) // 360 + 20 = 380, held at 150 x 1.25
    await run()
    expect(settleParams![2]).toBe(187.5)
    expect(repo.flagRideForReview).toHaveBeenCalledOnce()
  })

  it('a much shorter route is held at 25% under the quote and flagged', async () => {
    setup(2) // 24 + 20 = 44, below the Rs 50 minimum, held at 150 x 0.75
    await run()
    expect(settleParams![2]).toBe(112.5)
    expect(repo.flagRideForReview).toHaveBeenCalledOnce()
  })

  it('leaves the quote alone when there is no usable GPS trail', async () => {
    setup(null)
    await run()
    expect(settleParams).toBeUndefined()
  })

  it('fills a gap where the phone went quiet while the car moved with a route between the two fixes', async () => {
    const gap = { fromLat: 20.3, fromLng: 85.8, toLat: 20.33, toLng: 85.8, m: 3300, sec: 180 }
    vi.mocked(getRoute).mockResolvedValue({ distanceKm: 4, durationMin: 8, source: 'google' } as never)
    setup(6, 0, { gaps: [gap], silentMovedSec: 180 }) // 6 km tracked + 4 km routed = 10 km -> 140
    await run()
    expect(settleParams![2]).toBe(140)
    expect(settleParams![3]).toBe(10)
    expect(repo.flagRideForReview).toHaveBeenCalledWith(BigInt(101), expect.stringContaining('GPS gap'))
  })

  it('a small gap is routed and billed without bothering ops', async () => {
    const gap = { fromLat: 20.3, fromLng: 85.8, toLat: 20.31, toLng: 85.8, m: 1100, sec: 130 }
    vi.mocked(getRoute).mockResolvedValue({ distanceKm: 1.5, durationMin: 3, source: 'google' } as never)
    setup(8.5, 0, { gaps: [gap], silentMovedSec: 100 }) // under 10% of the 20-minute ride (a 40-minute ride would tolerate a 4-minute gap)
    await run()
    expect(settleParams![3]).toBe(10)
    expect(repo.flagRideForReview).not.toHaveBeenCalled()
  })

  it('does not trust a trail that is missing for more than 20% of the ride; the quote stands and ops is told', async () => {
    setup(4, 0, { silentMovedSec: 600 }) // 10 of 20 min with no trail
    await run()
    expect(settleParams).toBeUndefined()
    expect(repo.flagRideForReview).toHaveBeenCalledWith(BigInt(101), expect.stringContaining('GPS trail missing'))
  })

  it('time spent waiting at stops is not billed as trip time: the free window is free, the rest is billed once as wait', async () => {
    setup(10, 5, {}, 15) // 15 min at stops (10 free + 5 metered = Rs 5): billed time is 20 - 15 = 5 -> 120 + 5 = 125, wait added on top
    await run()
    expect(settleParams).toEqual([BigInt(101), 5, 125, 10, 20])
  })
})
