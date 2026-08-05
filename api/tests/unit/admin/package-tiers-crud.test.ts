import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }))

import { createPackageTier, updatePackageTier } from '@/modules/admin/admin.repository'

describe('admin package tier CRUD', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a tier with the given price/threshold', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: '1', label: 'Small', price: '39.00', threshold_value: '1000.00' }] })
    const tier = await createPackageTier({ label: 'Small', price: 39, thresholdValue: 1000, createdBy: BigInt(1) })
    expect(tier.threshold_value).toBe('1000.00')
  })

  it('toggles is_active on update', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: '1', is_active: false }] })
    const tier = await updatePackageTier(BigInt(1), { isActive: false })
    expect(tier?.is_active).toBe(false)
  })
})
