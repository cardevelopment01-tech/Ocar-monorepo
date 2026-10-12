import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn(), get: vi.fn(), del: vi.fn() } }))
vi.mock('@/config', () => ({
  config: {
    PAYU_KEY: 'testkey', PAYU_SALT: 'testsalt', PAYU_ENV: 'test',
    API_BASE_URL: 'https://api.example',
  },
}))

import { pool } from '@/db/client'
import { createRidePaymentOrder } from '@/modules/payments/payments.service'

describe('createRidePaymentOrder (PayU configured)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pool.query).mockImplementation(async (sql: unknown) => {
      if ((sql as string).includes('FROM users')) return { rows: [{ name: 'Asha', email: null, phone: '9999999999' }], rowCount: 1 } as never
      return { rows: [], rowCount: 1 } as never
    })
  })

  it('returns a signed PayU form for the fare and stores the txn on the payment row', async () => {
    const order = await createRidePaymentOrder(101n, 42n, 500)
    expect(order).not.toBeNull()
    expect(order!.amount).toBe(500)
    expect(order!.payu.action).toBe('https://test.payu.in/_payment')
    expect(order!.payu.fields['amount']).toBe('500.00')
    expect(order!.payu.fields['txnid']).toMatch(/^R101x[a-z0-9]+$/)
    expect(order!.payu.fields['surl']).toBe('https://api.example/api/v1/payments/payu/return')
    expect(order!.payu.fields['email']).toBe('user42@ocarindia.com')

    const update = vi.mocked(pool.query).mock.calls.find(c => (c[0] as string).includes('gateway_txn_id'))
    expect(update).toBeTruthy()
    expect(update![1]).toEqual([101n, order!.payu.fields['txnid']])
  })
})
