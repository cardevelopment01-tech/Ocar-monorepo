import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({
  getJSON: vi.fn(),
  setWithTTL: vi.fn().mockResolvedValue(undefined),
  client: { del: vi.fn().mockResolvedValue(1) },
}))

import { pool } from '@/db/client'
import { getJSON } from '@/db/redis'
import { getRentalPackage } from '@/modules/pricing/pricing.repository'

const FRESH = { id: 12, category_id: 2, package_fare: '500.00', stop_charge: '15.00', cancellation_fee: '50.00' }

describe('getRentalPackage cache', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('reads through to the database when the cached package predates the fee columns (migration 136)', async () => {
    vi.mocked(getJSON).mockResolvedValue({ id: 12, category_id: 2, package_fare: '500.00' } as never)
    vi.mocked(pool.query).mockResolvedValue({ rows: [FRESH], rowCount: 1 } as never)

    const pkg = await getRentalPackage(12)

    expect(pkg?.stop_charge).toBe('15.00')
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('serves a current cached package without touching the database', async () => {
    vi.mocked(getJSON).mockResolvedValue(FRESH as never)

    const pkg = await getRentalPackage(12)

    expect(pkg?.stop_charge).toBe('15.00')
    expect(pool.query).not.toHaveBeenCalled()
  })
})
