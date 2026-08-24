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

  it('negative balance: top-up clears debt first, only the remainder is spendable, split shown in ledger note', async () => {
    scriptTopup('-200.00', false) // driver owes ₹200
    await topUpDriverWallet(BigInt(42), 500, 'pay_debt')

    const ledgerCall = client.query.mock.calls.find(c => (c[0] as string).includes('INSERT INTO driver_wallet_ledger'))
    expect(ledgerCall, 'expected a driver_wallet_ledger insert').toBeDefined()
    const params = ledgerCall![1] as unknown[]
    // balance_after = -200 + 500 = 300 — the spendable remainder after clearing ₹200 dues
    expect(params[3]).toBe(300)
    // note documents the debt-first split: ₹200 cleared, ₹300 spendable
    const note = params[5] as string
    expect(note).toContain('200')
    expect(note).toContain('300')

    const updateCall = client.query.mock.calls.find(c => (c[0] as string).includes('UPDATE driver_wallets'))
    expect((updateCall![1] as unknown[])[1]).toBe(300)
  })

  it('positive balance: full amount spendable, plain top-up note (no debt-clearing text)', async () => {
    scriptTopup('100.00', false)
    await topUpDriverWallet(BigInt(42), 500, 'pay_pos')

    const ledgerCall = client.query.mock.calls.find(c => (c[0] as string).includes('INSERT INTO driver_wallet_ledger'))
    const params = ledgerCall![1] as unknown[]
    expect(params[3]).toBe(600) // 100 + 500
    expect(params[5] as string).toBe('Wallet top-up via Razorpay')
  })
})
