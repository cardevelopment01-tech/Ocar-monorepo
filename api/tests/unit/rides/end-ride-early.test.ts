import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { del: vi.fn() } }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn().mockResolvedValue(undefined) } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications' },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideCoreById: vi.fn(),
  logStatusHistory: vi.fn().mockResolvedValue(undefined),
  updateRideStatus: vi.fn().mockResolvedValue(undefined),
  updateRideStatusCAS: vi.fn().mockResolvedValue({ id: BigInt(202), status: 'completed' }),
}))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn().mockResolvedValue(undefined),
  deductCommission:    vi.fn().mockResolvedValue(undefined),
  creditCashback:      vi.fn().mockResolvedValue(undefined),
  confirmRidePayment:  vi.fn().mockResolvedValue(true),
  payFromUserWallet:   vi.fn().mockResolvedValue(true),
  createRidePaymentOrder: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('true') }))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyRideEvent: vi.fn(), notifyRidePaymentFailed: vi.fn().mockResolvedValue(undefined),
  notifyAllAdmins:         vi.fn().mockResolvedValue(undefined),
}))

import * as repo from '@/modules/rides/rides.repository'
import { pool } from '@/db/client'
import { endRideEarlyAsDriver } from '@/modules/rides/rides.service'

function baseRide(over: Record<string, unknown> = {}) {
  return {
    id: BigInt(202), user_id: 42, driver_id: 9, status: 'in_progress',
    ride_type: 'one_way', payment_channel: 'cash',
    origin_lat: 20.2961, origin_lng: 85.8245,
    started_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    ...over,
  }
}

describe('endRideEarlyAsDriver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.updateRideStatusCAS).mockResolvedValue({ id: BigInt(202), status: 'completed' } as never)
    vi.mocked(pool.query).mockImplementation((sql: unknown) => {
      const s = sql as string
      if (/FROM fare_snapshots fs\s+JOIN rate_cards/.test(s)) {
        return {
          rows: [{
            surge_multiplier: '1', stop_fare: '0', is_return_cab: false,
            rate_per_km: '12', rate_per_min: '1.5', min_fare: '60', return_rate_per_km: null,
            total_estimated: '200',
          }],
          rowCount: 1,
        } as never
      }
      return { rows: [], rowCount: 1 } as never
    })
  })

  it('rejects a ride that is not in_progress', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(baseRide({ status: 'accepted' }) as never)
    await expect(endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 3, 10))
      .rejects.toMatchObject({ httpStatus: 409 })
  })

  it('rejects a non-owner driver', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(baseRide({ driver_id: 999 }) as never)
    await expect(endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 3, 10))
      .rejects.toMatchObject({ httpStatus: 403 })
  })

  it('computes a partial fare and marks the ride completed', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(baseRide() as never)
    // rate_per_km=12, rate_per_min=1.5, min_fare=60 → metered = 3*12 + 10*1.5 = 51, floored to min_fare=60
    const result = await endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 3, 10)
    expect(result.success).toBe(true)
    expect(result.finalFare).toBe(60)
    expect(repo.logStatusHistory).toHaveBeenCalledWith(
      expect.objectContaining({ rideId: BigInt(202), fromStatus: 'in_progress', toStatus: 'completed', actor: 'driver' })
    )
  })

  it('caps the recalculated fare at the originally-quoted total_estimated', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(baseRide() as never)
    vi.mocked(pool.query).mockImplementation((sql: unknown) => {
      const s = sql as string
      if (/FROM fare_snapshots fs\s+JOIN rate_cards/.test(s)) {
        return {
          rows: [{
            surge_multiplier: '1', stop_fare: '0', is_return_cab: false,
            rate_per_km: '12', rate_per_min: '1.5', min_fare: '60', return_rate_per_km: null,
            total_estimated: '100',
          }],
          rowCount: 1,
        } as never
      }
      return { rows: [], rowCount: 1 } as never
    })
    // uncapped: 999*12 + 10*1.5 = 12003, floored to min_fare — far above total_estimated=100
    const result = await endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 999, 10)
    expect(result.success).toBe(true)
    expect(result.finalFare).toBe(100)
  })

  it('rejects with 409 when the CAS status update loses the race (already ended)', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(baseRide() as never)
    vi.mocked(repo.updateRideStatusCAS).mockResolvedValue(null as never)
    await expect(endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 3, 10))
      .rejects.toMatchObject({ httpStatus: 409 })
  })

  it('hourly window (pricing_version 2): keeps the booked-hours charge, still capped at the quote', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(baseRide({ ride_type: 'round_trip' }) as never)
    const snap = (total_estimated: string) => vi.mocked(pool.query).mockImplementation((sql: unknown) => {
      if (/FROM fare_snapshots fs\s+JOIN rate_cards/.test(sql as string)) {
        return {
          rows: [{
            surge_multiplier: '1', stop_fare: '0', is_return_cab: false,
            rate_per_km: '12', rate_per_min: '1.5', min_fare: '60', return_rate_per_km: null,
            total_estimated, pricing_version: 2, trip_hours: '6', waiting_fare: '108', hour_rate: '18',
          }],
          rowCount: 1,
        } as never
      }
      return { rows: [], rowCount: 1 } as never
    })
    snap('1228')
    // one_way part floors at min_fare 60, plus the 6 x 18 = 108 booked hours
    expect((await endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 3, 10)).finalFare).toBe(168)

    snap('150') // the quote is still the ceiling
    expect((await endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 3, 10)).finalFare).toBe(150)
  })
})

// D7 (owner decision): a rental is a reserved block of time, so ending it early bills the quoted package fare. A rental has no rate
// card after migration 136, and the driver-reported distance never changes what is billed.
describe('endRideEarlyAsDriver: rental', () => {
  const rentalQueries = () => vi.mocked(pool.query).mock.calls.map((c) => String(c[0]))

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getRideCoreById).mockResolvedValue(baseRide({ ride_type: 'rental' }) as never)
    vi.mocked(repo.updateRideStatusCAS).mockResolvedValue({ id: BigInt(202), status: 'completed' } as never)
    vi.mocked(pool.query).mockImplementation((sql: unknown) => {
      const s = sql as string
      if (/JOIN rate_cards/.test(s)) throw new Error('an early-ended rental must not read a rate card')
      if (/UPDATE fare_snapshots/.test(s) && /total_final\s*=\s*total_estimated/.test(s)) return { rows: [{ total_final: '500' }], rowCount: 1 } as never
      return { rows: [], rowCount: 1 } as never
    })
  })

  it('bills the quoted package fare, whatever distance the driver app reports', async () => {
    const near = await endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 3, 10)
    const far = await endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 999, 10)
    expect(near.finalFare).toBe(500)
    expect(far.finalFare).toBe(500)
  })

  it('only finalises a snapshot that is still an estimate, so a retry or a lost race never rewrites a final fare', async () => {
    await endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 3, 10)
    const update = vi.mocked(pool.query).mock.calls.find((c) => /UPDATE fare_snapshots/.test(String(c[0])))
    expect(String(update![0])).toMatch(/WHERE ride_id = \$1\s+AND status = 'estimate'/)
  })

  it('reports no fare and re-derives no discount when the snapshot was already final', async () => {
    vi.mocked(pool.query).mockImplementation((sql: unknown) => {
      const s = sql as string
      if (/UPDATE fare_snapshots/.test(s) && /total_final\s*=\s*total_estimated/.test(s)) return { rows: [], rowCount: 0 } as never
      return { rows: [], rowCount: 1 } as never
    })
    const result = await endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 3, 10)
    expect(result).not.toHaveProperty('finalFare')
  })

  it('records the measured km and minutes beside the unchanged fare', async () => {
    await endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 3, 10)
    const update = vi.mocked(pool.query).mock.calls.find((c) => /UPDATE fare_snapshots/.test(String(c[0])))
    expect(update![1]).toEqual([BigInt(202), 3, 10])
    expect(rentalQueries().some((q) => /JOIN rate_cards/.test(q))).toBe(false)
  })
})
