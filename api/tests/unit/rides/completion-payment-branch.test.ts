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
  getRideById:     vi.fn(),
  updateRideStatus: vi.fn(),
  logStatusHistory: vi.fn(),
}))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord:   vi.fn().mockResolvedValue(undefined),
  deductCommission:      vi.fn().mockResolvedValue(undefined),
  creditCashback:        vi.fn().mockResolvedValue(undefined),
  confirmRidePayment:    vi.fn().mockResolvedValue(true),
  payFromUserWallet:     vi.fn().mockResolvedValue(true),
  createRidePaymentOrder: vi.fn().mockResolvedValue({ orderId: 'order_XYZ', key: 'k', amount: 500 }),
}))

import * as repo from '@/modules/rides/rides.repository'
import * as pay  from '@/modules/payments/payments.service'
import { pool }  from '@/db/client'
import { socketEvents } from '@/websocket/socket.server'
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
  })

  it('cash: createPaymentRecord(cash_direct) + commission + cashback', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide('cash') as never)
    await verifyEndOTP(BigInt(9), BigInt(101), '1234')
    await flush()
    expect(pay.createPaymentRecord).toHaveBeenCalledWith(BigInt(101), 'cash_direct')
    expect(pay.deductCommission).toHaveBeenCalledWith(BigInt(101), BigInt(9))
    expect(pay.creditCashback).toHaveBeenCalled()
    expect(pay.createRidePaymentOrder).not.toHaveBeenCalled()
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
})
