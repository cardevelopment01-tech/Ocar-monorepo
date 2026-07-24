import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))
vi.mock('@/config', () => ({
  config: { BANK_ACCOUNT_ENCRYPTION_KEY: '0'.repeat(64) },
}))

import { submitDriverPan, verifyDriverPan } from '@/modules/payments/submodules/settlements/tax-profile.service'

describe('submitDriverPan', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts a valid PAN, encrypts it, and upserts pan_verified=false', async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 1 })
    await submitDriverPan(BigInt(42), 'ABCDE1234F')

    const [sql, params] = poolQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT INTO driver_tax_profile')
    expect(sql).toContain('ON CONFLICT (driver_id) DO UPDATE')
    expect(sql).toContain('pan_verified = false')
    expect(params[0]).toBe(BigInt(42))
    expect(params[1]).not.toBe('ABCDE1234F') // stored encrypted, not plaintext
  })

  it('lowercases/trims input before validating', async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 1 })
    await submitDriverPan(BigInt(42), '  abcde1234f  ')
    expect(poolQuery).toHaveBeenCalledTimes(1)
  })

  it('rejects a malformed PAN before touching the database', async () => {
    await expect(submitDriverPan(BigInt(42), 'not-a-pan')).rejects.toThrow('PAN is invalid')
    expect(poolQuery).not.toHaveBeenCalled()
  })
})

describe('verifyDriverPan', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates pan_verified and returns true when a row matched', async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 1 })
    const ok = await verifyDriverPan(BigInt(42), true)
    expect(ok).toBe(true)
    const [sql, params] = poolQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('SET pan_verified = $2')
    expect(params).toEqual([BigInt(42), true])
  })

  it('returns false when no driver_tax_profile row exists yet', async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 0 })
    const ok = await verifyDriverPan(BigInt(999), true)
    expect(ok).toBe(false)
  })
})
