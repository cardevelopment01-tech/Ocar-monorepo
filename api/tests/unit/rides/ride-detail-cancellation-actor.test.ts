import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() }, withTransaction: vi.fn() }))

vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))

import { pool } from '@/db/client'
import { getRideById } from '@/modules/rides/rides.repository'

describe('getRideById: who cancelled, and what it cost', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('asks for the cancel actor from ride_cancellations, joined on the ride', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never)
    await getRideById(7n)
    const sql = String(vi.mocked(pool.query).mock.calls[0]![0])
    expect(sql).toMatch(/rc\.actor\s+AS cancellation_actor/)
    expect(sql).toMatch(/LEFT JOIN ride_cancellations rc ON rc\.ride_id = r\.id/)
  })

  it('passes the actor through to the caller unchanged', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 7n, status: 'cancelled', cancellation_actor: 'driver' }] } as never)
    expect((await getRideById(7n))?.cancellation_actor).toBe('driver')
  })

  it('asks for the cancellation fee and whether it was waived', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never)
    await getRideById(7n)
    const sql = String(vi.mocked(pool.query).mock.calls[0]![0])
    // a waived fee reads as 0, not the amount that was waived
    expect(sql).toMatch(/CASE WHEN rc\.fee_waived THEN 0 ELSE rc\.fee_amount END\)::float8\s+AS cancellation_fee/)
    expect(sql).toMatch(/rc\.fee_waived\s+AS cancellation_fee_waived/)
  })
})
