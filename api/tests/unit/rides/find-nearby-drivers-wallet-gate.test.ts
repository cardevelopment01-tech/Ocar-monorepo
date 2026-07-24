import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({ pool: { query: (...args: unknown[]) => poolQuery(...args) } }))

import { findNearbyDrivers, findReturnCabDrivers } from '@/modules/rides/rides.repository'

describe('driver-matching queries — wallet balance gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    poolQuery.mockResolvedValue({ rows: [] })
  })

  it('findNearbyDrivers joins driver_wallets and filters on balance + is_frozen', async () => {
    await findNearbyDrivers({
      lat: 20.29, lng: 85.82, categoryId: BigInt(2), minWalletBalance: 500,
    })

    const [sql, params] = poolQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('driver_wallets')
    expect(sql).toContain('COALESCE(dw.balance, 0) >= $6')
    expect(sql).toContain('NOT COALESCE(dw.is_frozen, false)')
    expect(params).toContain(500)
  })

  it('findReturnCabDrivers joins driver_wallets and filters on balance + is_frozen', async () => {
    await findReturnCabDrivers({
      pickupLat: 20.29, pickupLng: 85.82, dropLat: 19.8, dropLng: 85.82,
      categoryId: BigInt(2), minWalletBalance: 500,
    })

    const [sql, params] = poolQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('driver_wallets')
    expect(sql).toContain('COALESCE(dw.balance, 0) >= $6')
    expect(sql).toContain('NOT COALESCE(dw.is_frozen, false)')
    expect(params).toContain(500)
  })
})
