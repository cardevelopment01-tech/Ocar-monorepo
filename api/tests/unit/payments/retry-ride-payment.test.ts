import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(client)) } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: 'rzp_test', RAZORPAY_KEY_SECRET: 'secret' } }))

const ordersCreate = vi.fn()
vi.mock('razorpay', () => ({
  default: class { orders = { create: ordersCreate, fetchPayments: vi.fn() }; payments = { fetch: vi.fn() } },
}))

import * as svc from '@/modules/payments/payments.service'
import { pool } from '@/db/client'

// Route pool.query by SQL fragment so tests don't depend on call ordering.
// `payment` is the row returned by the initial `SELECT ... FROM payments`.
function mockPool(payment: Record<string, unknown>) {
  vi.mocked(pool.query).mockImplementation(async (text: unknown) => {
    const sql = text as string
    if (sql.startsWith('SELECT user_id, channel, status, amount')) return { rows: [payment], rowCount: 1 } as never
    if (sql.includes("SET status='pending'")) return { rows: [], rowCount: 1 } as never       // reset UPDATE
    if (sql.includes("SET status = 'completed'")) return { rows: [{ driver_id: 9, user_id: 42, amount: '500.00' }], rowCount: 1 } as never
    if (sql.includes('razorpay_order_id = $2')) return { rows: [], rowCount: 1 } as never       // order id write
    if (sql.includes('system_config')) return { rows: [], rowCount: 0 } as never                // getConfigValue → fallback
    return { rows: [], rowCount: 0 } as never
  })
}

// client.query (pool.connect) drives payFromUserWallet / deductCommission / creditCashback.
function mockClient(balance: string) {
  client.query.mockReset()
  client.query.mockImplementation(async (text: unknown) => {
    const sql = text as string
    if (sql.includes('FROM user_wallets') && sql.includes('FOR UPDATE')) return { rows: [{ id: 5, balance }], rowCount: 1 } as never
    if (sql.includes('FROM driver_wallets') && sql.includes('FOR UPDATE')) return { rows: [{ id: 7, balance: '10000', is_frozen: false }], rowCount: 1 } as never
    if (sql.includes("entry_type = 'ride_debit'")) return { rows: [], rowCount: 0 } as never    // dedupe check
    return { rows: [], rowCount: 0 } as never
  })
}

describe('retryRidePayment', () => {
  beforeEach(() => { vi.clearAllMocks(); ordersCreate.mockResolvedValue({ id: 'order_new' }) })

  it('online → resets the row and mints a fresh Razorpay order', async () => {
    mockPool({ user_id: 42, channel: 'razorpay_online', status: 'failed', amount: '500.00' })
    const result = await svc.retryRidePayment(BigInt(101), BigInt(42))
    expect(vi.mocked(pool.query).mock.calls.some(c => (c[0] as string).includes("SET status='pending'"))).toBe(true)
    expect(ordersCreate).toHaveBeenCalledOnce()
    expect(result).toEqual({ channel: 'online', order: { orderId: 'order_new', key: 'rzp_test', amount: 500 } })
  })

  it('wallet with enough balance → debits, confirms, returns paid:true', async () => {
    mockPool({ user_id: 42, channel: 'platform_wallet', status: 'failed', amount: '500.00' })
    mockClient('1000.00')
    const result = await svc.retryRidePayment(BigInt(101), BigInt(42))
    expect(result).toEqual({ channel: 'wallet', paid: true })
    expect(vi.mocked(pool.query).mock.calls.some(c => (c[0] as string).includes("SET status = 'completed'"))).toBe(true)
  })

  it('wallet still insufficient → returns paid:false, does not confirm', async () => {
    mockPool({ user_id: 42, channel: 'platform_wallet', status: 'failed', amount: '500.00' })
    mockClient('100.00')
    const result = await svc.retryRidePayment(BigInt(101), BigInt(42))
    expect(result).toEqual({ channel: 'wallet', paid: false })
    expect(vi.mocked(pool.query).mock.calls.some(c => (c[0] as string).includes("SET status = 'completed'"))).toBe(false)
  })

  it('rejects a payment owned by a different user', async () => {
    mockPool({ user_id: 99, channel: 'razorpay_online', status: 'failed', amount: '500.00' })
    await expect(svc.retryRidePayment(BigInt(101), BigInt(42))).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('rejects a cash-channel payment', async () => {
    mockPool({ user_id: 42, channel: 'cash_direct', status: 'pending', amount: '500.00' })
    await expect(svc.retryRidePayment(BigInt(101), BigInt(42))).rejects.toMatchObject({ httpStatus: 400 })
  })

  it('rejects an already-completed payment', async () => {
    mockPool({ user_id: 42, channel: 'razorpay_online', status: 'completed', amount: '500.00' })
    await expect(svc.retryRidePayment(BigInt(101), BigInt(42))).rejects.toMatchObject({ httpStatus: 400 })
  })
})
