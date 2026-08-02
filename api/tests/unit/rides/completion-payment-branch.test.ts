import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { del: vi.fn() } }))
vi.mock('@/lib/otp', () => ({ generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'h') }))
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
  getRideById:      vi.fn(),
  updateRideStatus: vi.fn(),
  logStatusHistory: vi.fn(),
  getStopWaitTotal: vi.fn().mockResolvedValue(0),
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
import * as pay  from '@/modules/payments/payments.service'
import { pool }  from '@/db/client'
import { socketEvents } from '@/websocket/socket.server'
import { getConfigValue } from '@/lib/system-config'
import { verifyEndOTP } from '@/modules/rides/rides.service'

const flush = () => new Promise(r => setTimeout(r, 0)) // let the non-blocking void chain settle

function baseRide(channel: 'cash' | 'online' | 'wallet') {
  return {
    id: BigInt(101), user_id: 42, driver_id: 9, status: 'in_progress',
    ride_type: 'one_way', end_otp_hash: 'h', payment_channel: channel,
    origin_lat: 20.3, origin_lng: 85.8, user_phone: null,
  }
}

describe('verifyEndOTP — payment channel branch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // fare_snapshots amount lookup + any other pool.query → generic amount row
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ amount: '500.00' }], rowCount: 1 } as never)
    vi.mocked(repo.updateRideStatus).mockResolvedValue(undefined as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
    vi.mocked(getConfigValue).mockResolvedValue('true')
  })

  it('cash + kill switch ON (default): defers settlement, notifies driver app, no payment side-effects', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide('cash') as never)
    await verifyEndOTP(BigInt(9), BigInt(101), '1234')
    await flush()
    expect(pay.createPaymentRecord).not.toHaveBeenCalled()
    expect(pay.deductCommission).not.toHaveBeenCalled()
    expect(pay.creditCashback).not.toHaveBeenCalled()
    const emitted = vi.mocked(socketEvents.sendRideStatusUpdate).mock.calls
      .map(c => c[1] as Record<string, unknown>)
      .find(p => p['needsCashCollection'] === true)
    expect(emitted).toMatchObject({ status: 'completed', paymentChannel: 'cash', needsCashCollection: true, amount: 500 })
  })

  it('cash + kill switch OFF: legacy immediate settle — createPaymentRecord(cash_direct) + commission + cashback', async () => {
    vi.mocked(getConfigValue).mockResolvedValue('false')
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide('cash') as never)
    await verifyEndOTP(BigInt(9), BigInt(101), '1234')
    await flush()
    expect(pay.createPaymentRecord).toHaveBeenCalledWith(BigInt(101), 'cash_direct')
    expect(pay.deductCommission).toHaveBeenCalledWith(BigInt(101), BigInt(9))
    expect(pay.creditCashback).toHaveBeenCalled()
    expect(pay.createRidePaymentOrder).not.toHaveBeenCalled()

    // Must stamp cash_collected_at so a later collectCash call (client hasn't
    // learned the kill switch flipped) sees the ride already claimed and no-ops
    // instead of double-settling.
    const upd = vi.mocked(pool.query).mock.calls.find(
      c => /UPDATE rides/.test(c[0] as string) && /cash_collected_at/.test(c[0] as string),
    )
    expect(upd).toBeTruthy()
    expect(upd![1]).toEqual([BigInt(101), 500])
  })

  it('online: pending payment + order + emits razorpayOrderId, defers commission', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide('online') as never)
    await verifyEndOTP(BigInt(9), BigInt(101), '1234')
    await flush()
    expect(pay.createPaymentRecord).toHaveBeenCalledWith(BigInt(101), 'razorpay_online', { status: 'pending' })
    expect(pay.createRidePaymentOrder).toHaveBeenCalledWith(BigInt(101), BigInt(42), 500)
    expect(pay.deductCommission).not.toHaveBeenCalled()
    const emitted = vi.mocked(socketEvents.sendRideStatusUpdate).mock.calls
      .map(c => c[1] as Record<string, unknown>)
      .find(p => p['razorpayOrderId'] === 'order_XYZ')
    expect(emitted).toBeTruthy()
  })

  it('wallet: pending payment + wallet debit + confirm', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide('wallet') as never)
    await verifyEndOTP(BigInt(9), BigInt(101), '1234')
    await flush()
    expect(pay.createPaymentRecord).toHaveBeenCalledWith(BigInt(101), 'platform_wallet', { status: 'pending' })
    expect(pay.payFromUserWallet).toHaveBeenCalledWith(BigInt(101), BigInt(42), 500)
    expect(pay.confirmRidePayment).toHaveBeenCalledWith(BigInt(101))
  })

  it('one-way with stop-wait charge: HTTP response carries the authoritative finalFare (total_estimated + wait), not the stale estimate', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide('cash') as never)
    vi.mocked(repo.getStopWaitTotal).mockResolvedValueOnce(45)
    vi.mocked(pool.query).mockImplementation(((sql: string) => {
      if (/UPDATE fare_snapshots/.test(sql) && /total_final\s*=\s*round\(total_estimated/.test(sql)) {
        return Promise.resolve({ rows: [{ total_final: '545.00' }], rowCount: 1 })
      }
      return Promise.resolve({ rows: [{ amount: '500.00' }], rowCount: 1 })
    }) as never)

    const result = await verifyEndOTP(BigInt(9), BigInt(101), '1234', 12, 30)
    await flush()

    expect(result).toMatchObject({ success: true, rideId: '101', finalFare: 545 })
  })

  it('no wait charge / no early termination: finalFare omitted from response (client falls back to estimate, which equals final)', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide('cash') as never)
    vi.mocked(repo.getStopWaitTotal).mockResolvedValueOnce(0)

    const result = await verifyEndOTP(BigInt(9), BigInt(101), '1234')
    await flush()

    expect(result).toEqual({ success: true, rideId: '101' })
  })

  it('round_trip normal completion (no early termination): reconciles total_final against actual km/duration instead of leaving it null (bug fix)', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({
      id: BigInt(101), user_id: 42, driver_id: 9, status: 'in_progress',
      ride_type: 'round_trip', end_otp_hash: 'h', payment_channel: 'cash',
      origin_lat: 20.3, origin_lng: 85.8, user_phone: null,
    } as never)
    vi.mocked(repo.getStopWaitTotal).mockResolvedValueOnce(0)

    let capturedUpdateParams: unknown[] | undefined
    vi.mocked(pool.query).mockImplementation(((sql: string, params?: unknown[]) => {
      if (/FROM fare_snapshots fs\s+JOIN rate_cards/.test(sql)) {
        return Promise.resolve({
          rows: [{
            surge_multiplier: '1', stop_fare: '0', is_return_cab: false,
            rate_per_km: '12', rate_per_min: '1.5', min_fare: '500',
            return_rate_per_km: null, km_per_day: '250', driver_allowance_per_day: '300',
          }],
          rowCount: 1,
        })
      }
      if (/UPDATE fare_snapshots/.test(sql) && /total_final\s*=\s*COALESCE/.test(sql)) {
        capturedUpdateParams = params
        return Promise.resolve({ rows: [], rowCount: 1 })
      }
      return Promise.resolve({ rows: [{ amount: '500.00' }], rowCount: 1 })
    }) as never)

    // No end coordinates passed → old code never recalculated (early-termination
    // branch requires actualEndLat/Lng). New code must still reconcile.
    // Booked as ~1 day, actually took 30h (2 days by ceil), driven 400km.
    // days=2, packageKm=2*250=500 (>400 driven, no overage), driver_allowance=2*300=600
    // distance_fare=500*12=6000 → subtotal=6600, no surge → total_final=6600
    await verifyEndOTP(BigInt(9), BigInt(101), '1234', 400, 30 * 60)
    await flush()

    expect(capturedUpdateParams).toBeDefined()
    const totalFinal = capturedUpdateParams![3] as number
    expect(totalFinal).toBe(6600)
  })

  it('round_trip early termination (ends >500m from origin): bills one_way (driven + return estimate), no driver allowance, early_termination_km/min set', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({
      id: BigInt(101), user_id: 42, driver_id: 9, status: 'in_progress',
      ride_type: 'round_trip', end_otp_hash: 'h', payment_channel: 'cash',
      origin_lat: 20.3, origin_lng: 85.8, user_phone: null,
    } as never)
    vi.mocked(repo.getStopWaitTotal).mockResolvedValueOnce(0)

    let capturedUpdateParams: unknown[] | undefined
    vi.mocked(pool.query).mockImplementation(((sql: string, params?: unknown[]) => {
      // Driver ended 5km (5000m) from origin → PostGIS says the return leg
      // wasn't actually driven.
      if (/ST_Distance/.test(sql)) {
        return Promise.resolve({ rows: [{ metres: '5000' }], rowCount: 1 })
      }
      if (/FROM fare_snapshots fs\s+JOIN rate_cards/.test(sql)) {
        return Promise.resolve({
          rows: [{
            surge_multiplier: '1', stop_fare: '0', is_return_cab: false,
            rate_per_km: '12', rate_per_min: '1.5', min_fare: '500',
            return_rate_per_km: null, km_per_day: '250', driver_allowance_per_day: '300',
          }],
          rowCount: 1,
        })
      }
      if (/UPDATE fare_snapshots/.test(sql) && /total_final\s*=\s*COALESCE/.test(sql)) {
        capturedUpdateParams = params
        return Promise.resolve({ rows: [], rowCount: 1 })
      }
      return Promise.resolve({ rows: [{ amount: '500.00' }], rowCount: 1 })
    }) as never)

    // drivenKm = returnKm = 5 (both derived from the same PostGIS straight-
    // line distance to origin); returnMin = 5 / 0.5 = 10min at assumed 30km/h.
    // billedKm = 5+5 = 10, billedMin = 40 (actual driven duration) + 10 = 50.
    // Billed at one_way rates (no km_per_day/driver_allowance_per_day at all):
    // distance_fare=10*12=120, time_fare=50*1.5=75, metered=195,
    // floored at min_fare=500, no surge → total_final=500.
    await verifyEndOTP(BigInt(9), BigInt(101), '1234', 5, 40, 20.34, 85.84)
    await flush()

    expect(capturedUpdateParams).toBeDefined()
    const [, billedKm, billedMin, totalFinal, earlyTermKm, earlyTermMin] = capturedUpdateParams!
    expect(totalFinal).toBe(500)
    expect(billedKm).toBe(10)
    expect(billedMin).toBe(50)
    // Unlike the normal-completion case (early_termination_km/min = null),
    // these must be populated here.
    expect(earlyTermKm).toBe(5)
    expect(earlyTermMin).toBe(10)
  })
})
