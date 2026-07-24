import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(client)) } }))

import { topUpDriverWallet } from '@/modules/payments/payments.service'

function scriptTopup(balance: string, existingDupe: boolean) {
  client.query.mockReset()
  client.query
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })                     // BEGIN
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })                     // INSERT ... ON CONFLICT (ensure wallet)
    .mockResolvedValueOnce({ rows: [{ id: 5, balance }], rowCount: 1 })   // SELECT ... FOR UPDATE
    .mockResolvedValueOnce({ rows: existingDupe ? [{ id: 1 }] : [], rowCount: existingDupe ? 1 : 0 }) // idempotency check
    .mockResolvedValue({ rows: [], rowCount: 0 })                        // UPDATE + INSERT ledger + COMMIT
}

describe('topUpDriverWallet', () => {
  beforeEach(() => vi.clearAllMocks())

  it('credits balance and commits, without touching drivers.status', async () => {
    scriptTopup('100.00', false)
    await topUpDriverWallet(BigInt(42), 500, 'pay_123')

    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('lifetime_topup'))).toBe(true)
    expect(calls.some(s => s.includes('COMMIT'))).toBe(true)
    // Regression guard: a top-up must never reactivate a driver suspended
    // for an unrelated reason (e.g. a blacklisted vehicle) — see deductCommission.
    expect(calls.some(s => s.toLowerCase().includes('drivers') && s.toLowerCase().includes('set'))).toBe(false)
    expect(calls.some(s => s.includes('driver_status_history'))).toBe(false)
  })

  it('duplicate reference_id → idempotent no-op', async () => {
    scriptTopup('100.00', true)
    await topUpDriverWallet(BigInt(42), 500, 'pay_123')

    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('lifetime_topup'))).toBe(false)
    expect(calls.some(s => s.includes('ROLLBACK'))).toBe(true)
  })
})
