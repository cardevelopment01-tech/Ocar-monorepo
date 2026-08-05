import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))

import { getPackageWallet } from '@/modules/packages/packages.repository'

describe('getPackageWallet', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when the driver has no package wallet row yet', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] })
    const result = await getPackageWallet(BigInt(42))
    expect(result).toBeNull()
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining('FROM driver_package_wallets'), [BigInt(42)])
  })

  it('returns the wallet row when it exists', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: '1', driver_id: '42', balance: '250.00', is_frozen: false }] })
    const result = await getPackageWallet(BigInt(42))
    expect(result?.balance).toBe('250.00')
  })
})
