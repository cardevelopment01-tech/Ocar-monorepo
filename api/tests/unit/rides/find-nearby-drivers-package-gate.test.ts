import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))

import { findNearbyDrivers } from '@/modules/rides/rides.repository'

describe('findNearbyDrivers — package-mode city gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('branches eligibility on the nearest city billing_mode via SQL, not a JS filter', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] })
    await findNearbyDrivers({ lat: 20.29, lng: 85.82, categoryId: BigInt(1), minWalletBalance: 500 })

    const sql = poolQuery.mock.calls[0]?.[0] as string
    expect(sql).toContain("JOIN cities dc ON dc.id = d.city_id")
    expect(sql).toContain('driver_package_wallets')
    expect(sql).toContain("dc.billing_mode = 'package'")
    expect(sql).toContain("dc.billing_mode = 'commission'")
  })
})
