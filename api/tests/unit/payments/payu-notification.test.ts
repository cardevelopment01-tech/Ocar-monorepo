import { describe, it, expect, vi, beforeEach } from 'vitest'

const fakeClient = {
  query: vi.fn().mockResolvedValue({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 }),
  release: vi.fn(),
}
vi.mock('@/db/client', () => ({
  pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) },
}))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/config', () => ({
  config: { PAYU_KEY: 'testkey', PAYU_SALT: 'testsalt', PAYU_ENV: 'test', API_BASE_URL: 'https://api.example' },
}))
vi.mock('@/lib/payu', async (orig) => ({
  ...(await orig<typeof import('@/lib/payu')>()),
  verifyPayuResponseHash: vi.fn(),
  fetchPayuStatus: vi.fn(),
}))
vi.mock('@/modules/packages/packages.repository', () => ({
  findPurchaseByTxnId: vi.fn(), markPurchaseCompletedPayu: vi.fn(),
  findPendingPurchaseByOrderId: vi.fn(), markPurchaseCompleted: vi.fn(),
}))
vi.mock('@/modules/packages/packages.service', () => ({
  creditPackageBalance: vi.fn(), consumePackageBalance: vi.fn(),
}))
// The real module imports pool + queues; the service loads it lazily. The cache
// counters are used by reference-cache (getConfigValue on the confirm path).
vi.mock('@/observability/metrics', () => ({
  payuUnattributedCapturesTotal: { inc: vi.fn() },
  cacheHitsTotal: { inc: vi.fn() },
  cacheMissesTotal: { inc: vi.fn() },
}))

import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import * as payu from '@/lib/payu'
import * as pkgRepo from '@/modules/packages/packages.repository'
import * as pkgSvc from '@/modules/packages/packages.service'
import { payuUnattributedCapturesTotal } from '@/observability/metrics'
import { handlePayuNotification } from '@/modules/payments/payments.service'

const body = { txnid: 'R101xabc', status: 'success', mihpayid: '555', hash: 'x' }
const captured = (amountPaise: number) => ({ state: 'captured' as const, amountPaise, mihpayid: '555' })

/** Route pool.query by SQL fragment; unmatched statements succeed with 0 rows. */
function sql(map: Record<string, { rows: unknown[]; rowCount?: number }>) {
  vi.mocked(pool.query).mockImplementation((async (q: unknown) => {
    for (const [frag, res] of Object.entries(map)) if ((q as string).includes(frag)) return { rowCount: res.rows.length, ...res }
    return { rows: [], rowCount: 0 }
  }) as never)
}
const confirmingUpdateIssued = () =>
  fakeClient.query.mock.calls.some(c => (c[0] as string).includes("SET status = 'completed'"))
const pendingRide = { 'FROM payments WHERE gateway_txn_id': { rows: [{ ride_id: '101', amount: '500.00', status: 'pending' }] } }

describe('handlePayuNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(payu.verifyPayuResponseHash).mockReturnValue(true)
    vi.mocked(redis.get).mockReset()
    vi.mocked(pkgRepo.findPurchaseByTxnId).mockReset()
    vi.mocked(payuUnattributedCapturesTotal.inc).mockReset()
    fakeClient.query.mockReset()
    fakeClient.query.mockResolvedValue({ rows: [{ id: 1, balance: '1000', is_frozen: false, driver_id: 9, user_id: 5, amount: '500.00' }], rowCount: 1 })
  })

  it('invalid hash throws 400 and touches nothing', async () => {
    vi.mocked(payu.verifyPayuResponseHash).mockReturnValue(false)
    await expect(handlePayuNotification(body)).rejects.toMatchObject({ httpStatus: 400, code: 'WEBHOOK_INVALID_SIGNATURE' })
    expect(payu.fetchPayuStatus).not.toHaveBeenCalled()
    expect(pool.query).not.toHaveBeenCalled()
    expect(redis.get).not.toHaveBeenCalled()
  })

  it('ride captured with matching amount confirms (gateway=payu) and returns success', async () => {
    sql(pendingRide)
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(50000))
    const out = await handlePayuNotification(body)
    expect(out).toEqual({ kind: 'ride', id: '101', result: 'success' })
    expect(confirmingUpdateIssued()).toBe(true)
    const setCall = fakeClient.query.mock.calls.find(c => (c[0] as string).includes("SET status = 'completed'"))!
    expect(setCall[0]).toContain('gateway_payment_id')
    expect(setCall[1]).toEqual([101n, '555'])
  })

  it('replay on an already-completed ride payment: success, guarded confirm is a no-op', async () => {
    sql({
      'FROM payments WHERE gateway_txn_id': { rows: [{ ride_id: '101', amount: '500.00', status: 'completed' }] },
      // settled by THIS capture (same mihpayid) → a true replay
      'FROM payments WHERE ride_id': { rows: [{ status: 'completed', gateway_payment_id: '555' }] },
    })
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(50000))
    // The guarded UPDATE ... WHERE status = 'pending' matches nothing on a completed row.
    fakeClient.query.mockResolvedValue({ rows: [], rowCount: 0 })
    const out = await handlePayuNotification(body)
    expect(out).toEqual({ kind: 'ride', id: '101', result: 'success' })
    expect(confirmingUpdateIssued()).toBe(true)
    const sqls = fakeClient.query.mock.calls.map(c => c[0] as string)
    expect(sqls).toContain('ROLLBACK')
    expect(sqls).not.toContain('COMMIT')
    // No settlement path ran: no billing-mode read, no commission/cashback/ledger writes.
    expect(sqls.some(s => s.includes('billing_mode_snapshot'))).toBe(false)
    expect(sqls.some(s => s.includes('ledger'))).toBe(false)
    expect(pkgSvc.consumePackageBalance).not.toHaveBeenCalled()
    // No revive of a non-failed row.
    expect(vi.mocked(pool.query).mock.calls.some(c => (c[0] as string).includes("SET status = 'pending'"))).toBe(false)
    expect(payuUnattributedCapturesTotal.inc).not.toHaveBeenCalled()
  })

  it('second capture on a ride already settled by a DIFFERENT payment is flagged, not success', async () => {
    // retry race: R1 confirmed the ride, then the rider also paid R2 (this txn)
    sql({
      'FROM payments WHERE gateway_txn_id': { rows: [{ ride_id: '101', amount: '500.00', status: 'completed' }] },
      'FROM payments WHERE ride_id': { rows: [{ status: 'completed', gateway_payment_id: '444' }] },
    })
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(50000))
    fakeClient.query.mockResolvedValue({ rows: [], rowCount: 0 })
    const out = await handlePayuNotification(body)
    expect(out).toEqual({ kind: 'ride', id: '101', result: 'pending' }) // no error flag: not retryable
    expect(payuUnattributedCapturesTotal.inc).toHaveBeenCalledWith({ reason: 'duplicate_capture' })
    const ev = vi.mocked(pool.query).mock.calls.find(c => (c[0] as string).includes('INSERT INTO payment_gateway_events'))
    expect(ev).toBeTruthy()
    expect(ev![0]).toContain('false')
    expect(ev![1]![2]).toContain('capture on settled ride')
  })

  it('confirm loses a race with the fail-sweep (row re-failed) → flagged, not success', async () => {
    sql({
      'FROM payments WHERE gateway_txn_id': { rows: [{ ride_id: '101', amount: '500.00', status: 'failed' }] },
      'FROM payments WHERE ride_id': { rows: [{ status: 'failed', gateway_payment_id: null }] },
    })
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(50000))
    fakeClient.query.mockResolvedValue({ rows: [], rowCount: 0 }) // guarded UPDATE matched nothing
    const out = await handlePayuNotification(body)
    expect(out).toEqual({ kind: 'ride', id: '101', result: 'pending' })
    expect(payuUnattributedCapturesTotal.inc).toHaveBeenCalledWith({ reason: 'confirm_lost_race' })
    expect(vi.mocked(pool.query).mock.calls.some(c =>
      (c[0] as string).includes('INSERT INTO payment_gateway_events') && (c[0] as string).includes('false'))).toBe(true)
  })

  it('amount mismatch is not confirmed, is recorded unprocessed, and counts amount_mismatch', async () => {
    sql(pendingRide)
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(100)) // paid ₹1 for a ₹500 fare
    const out = await handlePayuNotification(body)
    expect(out).toEqual({ kind: 'ride', id: '101', result: 'pending' })
    expect(confirmingUpdateIssued()).toBe(false)
    const ev = vi.mocked(pool.query).mock.calls.find(c => (c[0] as string).includes('INSERT INTO payment_gateway_events'))
    expect(ev).toBeTruthy()
    expect(ev![0]).toContain('false') // processed = false
    expect(payuUnattributedCapturesTotal.inc).toHaveBeenCalledWith({ reason: 'amount_mismatch' })
  })

  it('a zero expected amount is never confirmed, even when PayU also reports 0', async () => {
    sql({})
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify({ driverId: '7', amountPaise: 0 }))
    vi.mocked(pkgRepo.findPurchaseByTxnId).mockResolvedValue(null)
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(0)) // PayU omitted amt
    const out = await handlePayuNotification({ ...body, txnid: 'W7xabc' })
    expect(out).toEqual({ kind: 'wallet', id: '7', result: 'pending' })
    expect(fakeClient.query).not.toHaveBeenCalled()
    expect(payuUnattributedCapturesTotal.inc).toHaveBeenCalledWith({ reason: 'amount_mismatch' })
  })

  it('captured on a failed ride payment revives it, then confirms', async () => {
    sql({ 'FROM payments WHERE gateway_txn_id': { rows: [{ ride_id: '101', amount: '500.00', status: 'failed' }] } })
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(50000))
    const out = await handlePayuNotification(body)
    expect(out.result).toBe('success')
    const revive = vi.mocked(pool.query).mock.calls.find(c =>
      (c[0] as string).includes("SET status = 'pending'") && (c[0] as string).includes("status = 'failed'"))
    expect(revive).toBeTruthy()
    expect(confirmingUpdateIssued()).toBe(true)
  })

  it('ride failed → result failed, no money movement, row left for retry', async () => {
    sql(pendingRide)
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue({ state: 'failed', amountPaise: 50000, mihpayid: '555' })
    expect(await handlePayuNotification(body)).toEqual({ kind: 'ride', id: '101', result: 'failed' })
    expect(confirmingUpdateIssued()).toBe(false)
  })

  it('verify_payment failure yields pending + error (retryable), not throw', async () => {
    sql(pendingRide)
    vi.mocked(payu.fetchPayuStatus).mockRejectedValue(new Error('PayU verify_payment HTTP 502'))
    await expect(handlePayuNotification(body)).resolves.toEqual({ kind: 'ride', id: '101', result: 'pending', error: true })
    expect(confirmingUpdateIssued()).toBe(false)
  })

  it('confirm failure after capture yields pending + error, not throw', async () => {
    sql(pendingRide)
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(50000))
    fakeClient.query.mockImplementation(async (q: string) => {
      if (q.includes("SET status = 'completed'")) throw new Error('connection reset')
      return { rows: [], rowCount: 0 }
    })
    await expect(handlePayuNotification(body)).resolves.toEqual({ kind: 'ride', id: '101', result: 'pending', error: true })
  })

  it('DB lookup failure yields unknown + pending + error, not throw', async () => {
    vi.mocked(pool.query).mockRejectedValue(new Error('pool exhausted'))
    await expect(handlePayuNotification(body)).resolves.toEqual({ kind: 'unknown', id: null, result: 'pending', error: true })
    expect(payu.fetchPayuStatus).not.toHaveBeenCalled()
  })

  it('Redis outage on the binding read yields pending + error, not throw', async () => {
    sql({})
    vi.mocked(pkgRepo.findPurchaseByTxnId).mockResolvedValue(null)
    vi.mocked(redis.get).mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(handlePayuNotification({ ...body, txnid: 'W7xabc' }))
      .resolves.toEqual({ kind: 'unknown', id: null, result: 'pending', error: true })
    expect(payu.fetchPayuStatus).not.toHaveBeenCalled()
  })

  it('audit-insert failure after a confirmed payment still returns success', async () => {
    vi.mocked(pool.query).mockImplementation((async (q: string) => {
      if (q.includes('INSERT INTO payment_gateway_events')) throw new Error('disk full')
      if (q.includes('FROM payments WHERE gateway_txn_id')) return { rows: [{ ride_id: '101', amount: '500.00', status: 'pending' }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    }) as never)
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(50000))
    await expect(handlePayuNotification(body)).resolves.toEqual({ kind: 'ride', id: '101', result: 'success' })
    expect(confirmingUpdateIssued()).toBe(true)
  })

  it('captured for unknown txn is recorded unprocessed, counts unknown_txn, and returns unknown', async () => {
    sql({})
    vi.mocked(redis.get).mockResolvedValue(null)
    vi.mocked(pkgRepo.findPurchaseByTxnId).mockResolvedValue(null)
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(50000))
    const out = await handlePayuNotification({ ...body, txnid: 'R101xold' })
    expect(out).toEqual({ kind: 'unknown', id: null, result: 'pending' })
    const ev = vi.mocked(pool.query).mock.calls.find(c => (c[0] as string).includes('INSERT INTO payment_gateway_events'))
    expect(ev).toBeTruthy()
    expect(ev![0]).toContain('false')
    expect(payuUnattributedCapturesTotal.inc).toHaveBeenCalledWith({ reason: 'unknown_txn' })
  })

  it('a metrics failure never changes the result', async () => {
    sql({})
    vi.mocked(redis.get).mockResolvedValue(null)
    vi.mocked(pkgRepo.findPurchaseByTxnId).mockResolvedValue(null)
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(50000))
    vi.mocked(payuUnattributedCapturesTotal.inc).mockImplementation(() => { throw new Error('registry broke') })
    await expect(handlePayuNotification({ ...body, txnid: 'R101xold' }))
      .resolves.toEqual({ kind: 'unknown', id: null, result: 'pending' })
  })

  it('wallet top-up: captured credits the bound driver once, using the PayU-verified amount', async () => {
    sql({})
    vi.mocked(pkgRepo.findPurchaseByTxnId).mockResolvedValue(null)
    // no prior ledger row for this reference → proceed to credit
    fakeClient.query.mockImplementation(async (q: string) =>
      q.includes('FROM driver_wallet_ledger WHERE wallet_id')
        ? { rows: [], rowCount: 0 }
        : { rows: [{ id: 1, balance: '1000' }], rowCount: 1 })
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify({ driverId: '7', amountPaise: 50000 }))
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(50000))
    const out = await handlePayuNotification({ ...body, txnid: 'W7xabc' })
    expect(out).toEqual({ kind: 'wallet', id: '7', result: 'success' })
    const ledger = fakeClient.query.mock.calls.find(c => (c[0] as string).includes('INSERT INTO driver_wallet_ledger'))
    expect(ledger).toBeTruthy()
    expect(ledger![1]).toContain('W7xabc') // reference_id = txnid → replay-safe
    expect(ledger![1]).toContain(500)
  })

  it('wallet top-up: amount mismatch credits nothing', async () => {
    sql({})
    vi.mocked(pkgRepo.findPurchaseByTxnId).mockResolvedValue(null)
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify({ driverId: '7', amountPaise: 50000 }))
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(100))
    const out = await handlePayuNotification({ ...body, txnid: 'W7xabc' })
    expect(out.result).toBe('pending')
    expect(fakeClient.query.mock.calls.some(c => (c[0] as string).includes('INSERT INTO driver_wallet_ledger'))).toBe(false)
  })

  it('double delivery credits wallet once (ledger dedupe by reference_id)', async () => {
    sql({})
    vi.mocked(pkgRepo.findPurchaseByTxnId).mockResolvedValue(null)
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify({ driverId: '7', amountPaise: 50000 }))
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(50000))
    // dupe row found for this reference → no second credit
    fakeClient.query.mockImplementation(async (q: string) => {
      if (q.includes('FROM driver_wallet_ledger WHERE wallet_id')) return { rows: [{ id: 99 }], rowCount: 1 }
      return { rows: [{ id: 1, balance: '1000' }], rowCount: 1 }
    })
    await handlePayuNotification({ ...body, txnid: 'W7xabc' })
    expect(fakeClient.query.mock.calls.some(c => (c[0] as string).includes('INSERT INTO driver_wallet_ledger'))).toBe(false)
  })

  const pendingPurchase = { id: '4', driver_id: '7', threshold_value: '1200.00', amount: '1000.00', status: 'pending', gateway_payment_id: null }

  it('package captured: claims the purchase and credits the threshold', async () => {
    sql({})
    vi.mocked(redis.get).mockResolvedValue(null)
    vi.mocked(pkgRepo.findPurchaseByTxnId).mockResolvedValue(pendingPurchase)
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(100000))
    vi.mocked(pkgRepo.markPurchaseCompletedPayu).mockResolvedValue({ id: '4', driver_id: '7', threshold_value: '1200.00' })
    const out = await handlePayuNotification({ ...body, txnid: 'P7xabc' })
    expect(out).toEqual({ kind: 'package', id: '7', result: 'success' })
    expect(pkgSvc.creditPackageBalance).toHaveBeenCalledTimes(1)
    expect(pkgSvc.creditPackageBalance).toHaveBeenCalledWith(7n, 1200, '555')
  })

  it('package: claim already won (credit may have failed last time) → re-runs the deduped credit with the stored payment id', async () => {
    sql({})
    vi.mocked(redis.get).mockResolvedValue(null)
    vi.mocked(pkgRepo.findPurchaseByTxnId)
      .mockResolvedValueOnce(pendingPurchase) // resolution (stale read)
      .mockResolvedValueOnce({ ...pendingPurchase, status: 'completed', gateway_payment_id: '555' }) // re-read
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(100000))
    vi.mocked(pkgRepo.markPurchaseCompletedPayu).mockResolvedValue(null)
    const out = await handlePayuNotification({ ...body, txnid: 'P7xabc' })
    expect(out).toEqual({ kind: 'package', id: '7', result: 'success' })
    // creditPackageBalance dedupes on (wallet, reference_id) → a no-op if it already ran
    expect(pkgSvc.creditPackageBalance).toHaveBeenCalledTimes(1)
    expect(pkgSvc.creditPackageBalance).toHaveBeenCalledWith(7n, 1200, '555')
  })

  it('package: claim lost and purchase not completed → no credit', async () => {
    sql({})
    vi.mocked(redis.get).mockResolvedValue(null)
    vi.mocked(pkgRepo.findPurchaseByTxnId)
      .mockResolvedValueOnce(pendingPurchase)
      .mockResolvedValueOnce({ ...pendingPurchase, status: 'failed' })
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue(captured(100000))
    vi.mocked(pkgRepo.markPurchaseCompletedPayu).mockResolvedValue(null)
    await handlePayuNotification({ ...body, txnid: 'P7xabc' })
    expect(pkgSvc.creditPackageBalance).not.toHaveBeenCalled()
  })
})
