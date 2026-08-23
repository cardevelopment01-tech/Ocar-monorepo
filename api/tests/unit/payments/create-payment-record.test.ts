import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
// createPaymentRecord's commission-percent lookup now reads through
// getConfigValue -> the system_config cache (@/lib/cache/reference-cache ->
// @/db/redis) — without this mock it hits a real, reachable local Redis and
// can skip a pool.query call on a cache hit, desyncing the mockResolvedValueOnce
// sequence below (same fix as tests/unit/pricing/pricing.repository.test.ts).
vi.mock('@/db/redis', () => ({
  getJSON: vi.fn().mockResolvedValue(null),
  setWithTTL: vi.fn().mockResolvedValue(undefined),
  client: { del: vi.fn().mockResolvedValue(1) },
}))

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
    const insert = vi.mocked(pool.query).mock.calls.find(([sql]) => (sql as string).includes('INSERT INTO payments'))!
    const sql = insert[0] as string
    const params = insert[1] as unknown[]
    expect(sql).toContain('captured_at')
    expect(params).toContain('completed')
    expect(params).toContain('cash_direct')
    expect(params[params.length - 1]).toBeInstanceOf(Date)
  })

  it('online: inserts status=pending with NULL captured_at', async () => {
    await createPaymentRecord(BigInt(101), 'razorpay_online', { status: 'pending' })
    const insert = vi.mocked(pool.query).mock.calls.find(([sql]) => (sql as string).includes('INSERT INTO payments'))!
    const params = insert[1] as unknown[]
    expect(params).toContain('pending')
    expect(params).toContain('razorpay_online')
    expect(params[params.length - 1]).toBeNull()
  })
})
