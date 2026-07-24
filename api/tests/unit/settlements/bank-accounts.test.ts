import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args), connect: vi.fn(() => Promise.resolve(client)) },
}))
vi.mock('@/config', () => ({
  config: {
    RAZORPAY_KEY_ID: '',
    RAZORPAY_KEY_SECRET: '',
    BANK_ACCOUNT_ENCRYPTION_KEY: '0'.repeat(64),
  },
}))

import { addBankAccount } from '@/modules/payments/submodules/settlements/bank-accounts.service'

describe('addBankAccount', () => {
  beforeEach(() => vi.clearAllMocks())

  it('dev mode (no Razorpay keys): inserts as verified immediately, unsets other primaries', async () => {
    client.query.mockResolvedValue({ rows: [{ id: 5 }], rowCount: 1 })

    const id = await addBankAccount(BigInt(42), {
      accountHolderName: 'Test Driver', accountNumber: '1234567890', ifsc: 'HDFC0001234',
    })

    expect(id).toBe(BigInt(5))
    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('UPDATE driver_bank_accounts') && s.includes('is_primary = false'))).toBe(true)
    expect(calls.some(s => s.includes('INSERT INTO driver_bank_accounts') && s.includes("'verified'"))).toBe(true)
  })
})
