import { describe, it, expect, vi, beforeEach } from 'vitest'

// confirmRidePayment's status flip now runs on a pool.connect() transaction
// client (single-txn settlement refactor) — only exercised by the
// "ride payment short-circuits" case below, which never gets far enough to
// need a fully scripted client (the flip's 0-rowCount is never reached; the
// SELECT on rideLookupHit already returns a match before that point).
const fakeClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() }
vi.mock('@/db/client', () => ({
  pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) },
}))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' } }))

const findPendingPurchaseByOrderId = vi.fn()
const markPurchaseCompleted = vi.fn()
vi.mock('@/modules/packages/packages.repository', () => ({
  findPendingPurchaseByOrderId: (...a: unknown[]) => findPendingPurchaseByOrderId(...a),
  markPurchaseCompleted: (...a: unknown[]) => markPurchaseCompleted(...a),
}))

const creditPackageBalance = vi.fn(() => Promise.resolve())
vi.mock('@/modules/packages/packages.service', () => ({
  creditPackageBalance: (...a: unknown[]) => creditPackageBalance(...a),
  consumePackageBalance: vi.fn(() => Promise.resolve()),
}))

import { handleWebhookEvent } from '@/modules/payments/payments.service'
import { pool } from '@/db/client'

function capturedPayload(paymentId: string, orderId: string) {
  return {
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, status: 'captured' } } },
  }
}

// pool.query is mocked by matching on SQL substrings (like webhook-captured.test.ts)
// rather than a fixed call sequence, so this stays correct even if handleWebhookEvent's
// internal query order shifts.
function mockPoolForOrderLookup(opts: { rideLookupHit: boolean }) {
  vi.mocked(pool.query).mockImplementation(async (text: unknown) => {
    const sql = text as string
    if (sql.includes('SELECT id FROM payment_gateway_events')) {
      return { rows: [], rowCount: 0 } as never // dedupe: not seen
    }
    if (sql.includes('INSERT INTO payment_gateway_events')) {
      return { rows: [], rowCount: 1 } as never
    }
    if (sql.includes('FROM payments') && sql.includes('razorpay_order_id')) {
      // No matching ride-payment order — this order belongs to a package purchase instead.
      return opts.rideLookupHit
        ? ({ rows: [{ ride_id: 101 }], rowCount: 1 } as never)
        : ({ rows: [], rowCount: 0 } as never)
    }
    return { rows: [], rowCount: 0 } as never
  })
}

describe('handleWebhookEvent — payment.captured for a package purchase order', () => {
  beforeEach(() => vi.clearAllMocks())

  it('credits the package wallet when the order matches a pending package purchase', async () => {
    mockPoolForOrderLookup({ rideLookupHit: false })
    findPendingPurchaseByOrderId.mockResolvedValueOnce({
      id: '9', driver_id: '42', threshold_value: '10000.00',
    })
    markPurchaseCompleted.mockResolvedValueOnce({
      id: '9', driver_id: '42', threshold_value: '10000.00',
    })

    await handleWebhookEvent(capturedPayload('pay_123', 'order_abc'))

    expect(findPendingPurchaseByOrderId).toHaveBeenCalledWith('order_abc')
    expect(markPurchaseCompleted).toHaveBeenCalledWith('9', 'pay_123')
    expect(creditPackageBalance).toHaveBeenCalledWith(BigInt(42), 10000, 'pay_123')
  })

  it('no-ops when the order matches neither a ride payment nor a package purchase', async () => {
    mockPoolForOrderLookup({ rideLookupHit: false })
    findPendingPurchaseByOrderId.mockResolvedValueOnce(null)

    await handleWebhookEvent(capturedPayload('pay_999', 'order_unknown'))

    expect(creditPackageBalance).not.toHaveBeenCalled()
    expect(markPurchaseCompleted).not.toHaveBeenCalled()
  })

  it('does not credit the wallet when markPurchaseCompleted loses the atomic claim (concurrent webhook or already-completed row)', async () => {
    mockPoolForOrderLookup({ rideLookupHit: false })
    findPendingPurchaseByOrderId.mockResolvedValueOnce({
      id: '9', driver_id: '42', threshold_value: '10000.00',
    })
    markPurchaseCompleted.mockResolvedValueOnce(null)

    await handleWebhookEvent(capturedPayload('pay_123', 'order_abc'))

    expect(markPurchaseCompleted).toHaveBeenCalledWith('9', 'pay_123')
    expect(creditPackageBalance).not.toHaveBeenCalled()
  })

  it('a matching ride payment short-circuits before the package-purchase lookup', async () => {
    mockPoolForOrderLookup({ rideLookupHit: true })

    await handleWebhookEvent(capturedPayload('pay_1', 'order_1'))

    expect(findPendingPurchaseByOrderId).not.toHaveBeenCalled()
    expect(creditPackageBalance).not.toHaveBeenCalled()
  })
})
