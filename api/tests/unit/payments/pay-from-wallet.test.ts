import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(client)) } }))

import { payFromUserWallet } from '@/modules/payments/payments.service'

// Helper: script the client.query call sequence for one invocation.
function scriptWallet(balance: string, existingDebit: boolean) {
  client.query.mockReset()
  client.query
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })                       // BEGIN
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })                       // INSERT ... ON CONFLICT (ensure wallet)
    .mockResolvedValueOnce({ rows: [{ id: 5, balance }], rowCount: 1 })     // SELECT ... FOR UPDATE
    .mockResolvedValueOnce({ rows: existingDebit ? [{ id: 1 }] : [], rowCount: existingDebit ? 1 : 0 }) // dedupe check
    .mockResolvedValue({ rows: [], rowCount: 0 })                           // UPDATE + INSERT ledger + COMMIT/ROLLBACK
}

describe('payFromUserWallet', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sufficient balance → debits and returns true', async () => {
    scriptWallet('1000.00', false)
    const ok = await payFromUserWallet(BigInt(101), BigInt(42), 500)
    expect(ok).toBe(true)
    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('lifetime_spent'))).toBe(true)
    expect(calls.some(s => s.includes("'ride_debit'"))).toBe(true)
    expect(calls.some(s => s.includes('COMMIT'))).toBe(true)
  })

  it('insufficient balance → rolls back and returns false', async () => {
    scriptWallet('100.00', false)
    const ok = await payFromUserWallet(BigInt(101), BigInt(42), 500)
    expect(ok).toBe(false)
    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('ROLLBACK'))).toBe(true)
    expect(calls.some(s => s.includes('lifetime_spent'))).toBe(false)
  })

  it('existing ride_debit ledger row → idempotent no-op, returns true', async () => {
    scriptWallet('1000.00', true)
    const ok = await payFromUserWallet(BigInt(101), BigInt(42), 500)
    expect(ok).toBe(true)
    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('lifetime_spent'))).toBe(false) // did not debit again
  })
})
