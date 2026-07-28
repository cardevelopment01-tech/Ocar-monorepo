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
  getRideById: vi.fn(),
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
  notifyRidePaymentFailed: vi.fn().mockResolvedValue(undefined),
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
          }],
          rowCount: 1,
        } as never
      }
      return { rows: [], rowCount: 1 } as never
    })
  })

  it('rejects a ride that is not in_progress', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide({ status: 'accepted' }) as never)
    await expect(endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 3, 10))
      .rejects.toMatchObject({ httpStatus: 409 })
  })

  it('rejects a non-owner driver', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide({ driver_id: 999 }) as never)
    await expect(endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 3, 10))
      .rejects.toMatchObject({ httpStatus: 403 })
  })

  it('computes a partial fare and marks the ride completed', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide() as never)
    // rate_per_km=12, rate_per_min=1.5, min_fare=60 → metered = 3*12 + 10*1.5 = 51, floored to min_fare=60
    const result = await endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 3, 10)
    expect(result.success).toBe(true)
    expect(result.finalFare).toBe(60)
    expect(repo.logStatusHistory).toHaveBeenCalledWith(
      expect.objectContaining({ rideId: BigInt(202), fromStatus: 'in_progress', toStatus: 'completed', actor: 'driver' })
    )
  })

  it('rejects with 409 when the CAS status update loses the race (already ended)', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide() as never)
    vi.mocked(repo.updateRideStatusCAS).mockResolvedValue(null as never)
    await expect(endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 3, 10))
      .rejects.toMatchObject({ httpStatus: 409 })
  })
})
