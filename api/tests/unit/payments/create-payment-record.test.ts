import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@/db/client'
import { createPaymentRecord } from '@/modules/payments/payments.service'

const FARE_ROW = { rows: [{ fare_snapshot_id: 7, total_final: '500.00', total_estimated: '480.00',
  user_id: 42, driver_id: 9 }], rowCount: 1 }

describe('createPaymentRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 1st call: fare snapshot lookup. 2nd call (getCommissionPercent): system_config. 3rd: INSERT.
    vi.mocked(pool.query)
      .mockResolvedValueOnce(FARE_ROW as never)          // fare join
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // commission config → fallback 15
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // INSERT
  })

  it('cash: inserts status=completed with captured_at=now()', async () => {
    await createPaymentRecord(BigInt(101), 'cash_direct')
    const insert = vi.mocked(pool.query).mock.calls[2]!
    const sql = insert[0] as string
    const params = insert[1] as unknown[]
    expect(sql).toContain('captured_at')
    expect(sql).toContain('now()')
    expect(params).toContain('completed')
    expect(params).toContain('cash_direct')
  })

  it('online: inserts status=pending with NULL captured_at', async () => {
    await createPaymentRecord(BigInt(101), 'razorpay_online', { status: 'pending' })
    const insert = vi.mocked(pool.query).mock.calls[2]!
    const sql = insert[0] as string
    const params = insert[1] as unknown[]
    expect(sql).not.toContain('now()')
    expect(params).toContain('pending')
    expect(params).toContain('razorpay_online')
  })
})
