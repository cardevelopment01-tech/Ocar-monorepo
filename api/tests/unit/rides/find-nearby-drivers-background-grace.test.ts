import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({ pool: { query: (...args: unknown[]) => poolQuery(...args) } }))

import { findNearbyDrivers } from '@/modules/rides/rides.repository'
import { BACKGROUND_MATCH_GRACE_SECONDS } from '@/constants/limits'

describe('findNearbyDrivers — recently-backgrounded driver grace window', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    poolQuery.mockResolvedValue({ rows: [] })
  })

  it('admits is_available=false rows within the grace window, gated on ds.status = online', async () => {
    await findNearbyDrivers({
      lat: 20.29, lng: 85.82, categoryIds: [BigInt(2)], minWalletBalance: 500,
    })

    const [sql, params] = poolQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('dls.is_available = true')
    expect(sql).toContain("dls.is_available = false AND dls.updated_at > now() - ($7 || ' seconds')::interval")
    expect(sql).toContain("ds.status = 'online'")
    expect(sql).toContain('dls.is_available')
    expect(params).toContain(BACKGROUND_MATCH_GRACE_SECONDS)
  })
})
