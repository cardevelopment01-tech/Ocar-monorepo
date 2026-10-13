import { describe, it, expect, vi, beforeEach } from 'vitest'

// The claim + settlement now run on ONE transaction client (so a mid-settlement failure rolls the claim back).
const fakeClient = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) } }))
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
  getRideCoreById: vi.fn(),
}))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn().mockResolvedValue(undefined),
  deductCommission:    vi.fn().mockResolvedValue(undefined),
  creditCashback:      vi.fn().mockResolvedValue(undefined),
  confirmRidePayment:  vi.fn().mockResolvedValue(true),
  payFromUserWallet:   vi.fn().mockResolvedValue(true),
  createRidePaymentOrder: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('1') }))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyRideEvent: vi.fn(), notifyRidePaymentFailed: vi.fn().mockResolvedValue(undefined),
  notifyAllAdmins:         vi.fn().mockResolvedValue(undefined),
  notifyDriverLowWalletBalance: vi.fn().mockResolvedValue(undefined),
}))

import * as repo from '@/modules/rides/rides.repository'
import * as pay  from '@/modules/payments/payments.service'
import { pool }  from '@/db/client'
import { getConfigValue } from '@/lib/system-config'
import { notifyAllAdmins } from '@/modules/notifications/notifications.service'
import { collectCash } from '@/modules/rides/rides.service'

function baseRide(over: Record<string, unknown> = {}) {
  return {
    id: BigInt(101), user_id: 42, driver_id: 9, status: 'completed',
    payment_channel: 'cash',
    cash_collected_amount: null, cash_collected_at: null, cash_discrepancy: false,
    ...over,
  }
}

describe('collectCash', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // pool.query: fare_snapshots lookup → 480. The transaction client: BEGIN/COMMIT ok, claim UPDATE → rowCount 1.
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ amount: '480.00' }], rowCount: 1 } as never)
    fakeClient.query.mockReset()
    fakeClient.query.mockResolvedValue({ rows: [], rowCount: 1 })
    vi.mocked(getConfigValue).mockResolvedValue('1')
  })

  it('happy path: exact collection settles, no discrepancy', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(baseRide() as never)
    const res = await collectCash(BigInt(9), BigInt(101), { collectedAmount: 480 })

    expect(res).toEqual({ collected: 480, discrepancy: false })

    // UPDATE rides sets amount 480 + discrepancy false, on the transaction client
    const upd = fakeClient.query.mock.calls.find(c => /UPDATE rides/.test(c[0] as string))
    expect(upd).toBeTruthy()
    expect(upd![1]).toEqual([BigInt(101), 480, false, null])

    // Settlement shares the claim's transaction (last arg = the client), then commits once.
    expect(pay.createPaymentRecord).toHaveBeenCalledWith(BigInt(101), 'cash_direct', {}, fakeClient)
    expect(pay.deductCommission).toHaveBeenCalledWith(BigInt(101), BigInt(9), fakeClient)
    expect(pay.creditCashback).toHaveBeenCalledWith(BigInt(101), BigInt(42), 480, fakeClient)
    const sqls = fakeClient.query.mock.calls.map(c => c[0] as string)
    expect(sqls.filter(s => s === 'COMMIT').length).toBe(1)
    expect(sqls).not.toContain('ROLLBACK')
    expect(notifyAllAdmins).not.toHaveBeenCalled()
  })

  it('short collection: commission still accrues on fare, flags discrepancy', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(baseRide() as never)
    const res = await collectCash(BigInt(9), BigInt(101), { collectedAmount: 300, note: 'rider short' })

    expect(res).toEqual({ collected: 300, discrepancy: true })

    const upd = fakeClient.query.mock.calls.find(c => /UPDATE rides/.test(c[0] as string))
    expect(upd![1]).toEqual([BigInt(101), 300, true, 'rider short'])

    // commission is fare-based regardless of shortfall
    expect(pay.createPaymentRecord).toHaveBeenCalledWith(BigInt(101), 'cash_direct', {}, fakeClient)
    expect(pay.deductCommission).toHaveBeenCalledWith(BigInt(101), BigInt(9), fakeClient)
    expect(pay.creditCashback).toHaveBeenCalledWith(BigInt(101), BigInt(42), 480, fakeClient)
    expect(notifyAllAdmins).toHaveBeenCalled()
  })

  it('not collected: collected 0, discrepancy true, commission still accrues', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(baseRide() as never)
    const res = await collectCash(BigInt(9), BigInt(101), { notCollected: true, note: 'no cash' })

    expect(res).toEqual({ collected: 0, discrepancy: true })
    const upd = fakeClient.query.mock.calls.find(c => /UPDATE rides/.test(c[0] as string))
    expect(upd![1]).toEqual([BigInt(101), 0, true, 'no cash'])
    expect(pay.deductCommission).toHaveBeenCalledWith(BigInt(101), BigInt(9), fakeClient)
    expect(notifyAllAdmins).toHaveBeenCalled()
  })

  it('idempotent: already collected → returns early, no re-settle', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(
      baseRide({ cash_collected_at: '2026-07-27T10:00:00Z', cash_collected_amount: '480.00', cash_discrepancy: false }) as never,
    )
    const res = await collectCash(BigInt(9), BigInt(101), { collectedAmount: 480 })
    expect(res).toEqual({ collected: 480, discrepancy: false })
    expect(pay.createPaymentRecord).not.toHaveBeenCalled()
    expect(pay.deductCommission).not.toHaveBeenCalled()
  })

  it('claim lost (concurrent settle): no double-settle, returns fresh ride state', async () => {
    // read-time guard passes (cash_collected_at null), but the atomic UPDATE claims
    // 0 rows because a concurrent call already settled.
    vi.mocked(repo.getRideCoreById)
      .mockResolvedValueOnce(baseRide() as never) // first read: unsettled
      .mockResolvedValueOnce(baseRide({ cash_collected_amount: '480.00', cash_discrepancy: false, cash_collected_at: 'x' }) as never) // fresh read after lost claim
    fakeClient.query.mockImplementation((sql: unknown) =>
      Promise.resolve(/UPDATE rides/.test(sql as string) ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 }), // claim lost
    )

    const res = await collectCash(BigInt(9), BigInt(101), { collectedAmount: 480 })
    expect(res).toEqual({ collected: 480, discrepancy: false })
    expect(fakeClient.query.mock.calls.map(c => c[0])).toContain('ROLLBACK')
    expect(pay.createPaymentRecord).not.toHaveBeenCalled()
    expect(pay.deductCommission).not.toHaveBeenCalled()
    expect(pay.creditCashback).not.toHaveBeenCalled()
  })

  it('a settlement failure ROLLS BACK the claim, so the driver can retry (commission is never skipped)', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(baseRide() as never)
    vi.mocked(pay.deductCommission).mockRejectedValueOnce(new Error('db blip'))

    await expect(collectCash(BigInt(9), BigInt(101), { collectedAmount: 480 })).rejects.toThrow('db blip')

    const sqls = fakeClient.query.mock.calls.map(c => c[0] as string)
    expect(sqls).toContain('ROLLBACK')
    expect(sqls).not.toContain('COMMIT') // cash_collected_at was never committed
    expect(fakeClient.release).toHaveBeenCalled()
  })

  it('rejects non-owner driver with 403', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(baseRide({ driver_id: 999 }) as never)
    await expect(collectCash(BigInt(9), BigInt(101), { collectedAmount: 480 }))
      .rejects.toMatchObject({ httpStatus: 403 })
  })

  it('rejects non-completed ride with 409', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(baseRide({ status: 'in_progress' }) as never)
    await expect(collectCash(BigInt(9), BigInt(101), { collectedAmount: 480 }))
      .rejects.toMatchObject({ httpStatus: 409 })
  })
})
