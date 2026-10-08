import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(client)) } }))

vi.mock('@/db/redis', () => ({ client: { set: vi.fn(), get: vi.fn(), del: vi.fn() } }))
vi.mock('@/config', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/config')>()
  return {
    ...orig,
    config: { ...orig.config, PAYU_KEY: 'testkey', PAYU_SALT: 'testsalt', PAYU_ENV: 'test', API_BASE_URL: 'https://api.example' },
  }
})

import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { topUpDriverWallet, createDriverTopupOrder } from '@/modules/payments/payments.service'

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
    expect(note).toBe('Wallet top-up ₹500 (₹200 cleared dues, ₹300 spendable)') // gateway-neutral

    const updateCall = client.query.mock.calls.find(c => (c[0] as string).includes('UPDATE driver_wallets'))
    expect((updateCall![1] as unknown[])[1]).toBe(300)
  })

  it('positive balance: full amount spendable, plain top-up note (no debt-clearing text)', async () => {
    scriptTopup('100.00', false)
    await topUpDriverWallet(BigInt(42), 500, 'pay_pos')

    const ledgerCall = client.query.mock.calls.find(c => (c[0] as string).includes('INSERT INTO driver_wallet_ledger'))
    const params = ledgerCall![1] as unknown[]
    expect(params[3]).toBe(600) // 100 + 500
    expect(params[5] as string).toBe('Wallet top-up')
  })
})

describe('createDriverTopupOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ name: 'Ravi', email: null, phone: '8888888888' }], rowCount: 1 } as never)
  })

  it('binds txnid → driver + paise in Redis for 24h and returns the signed form', async () => {
    const out = await createDriverTopupOrder(7n, 500)
    const txnId = out.payu.fields['txnid']!
    expect(txnId).toMatch(/^W7x/)
    expect(out.payu.fields['amount']).toBe('500.00')
    expect(vi.mocked(redis.set)).toHaveBeenCalledWith(
      `wallet:topup_order:${txnId}`, JSON.stringify({ driverId: '7', amountPaise: 50000 }), 'EX', 86400,
    )
  })

  it('persists a durable wallet_topup_orders row (driver, txnid, rupees) alongside the Redis binding', async () => {
    const out = await createDriverTopupOrder(7n, 500)
    const txnId = out.payu.fields['txnid']!
    const ins = vi.mocked(pool.query).mock.calls.find(c => (c[0] as string).includes('INSERT INTO wallet_topup_orders'))
    expect(ins).toBeTruthy()
    expect(ins![0]).toContain('(driver_id, gateway_txn_id, amount)')
    expect(ins![1]).toEqual([7n, txnId, 500])
    expect(vi.mocked(redis.set)).toHaveBeenCalledTimes(1)
  })

  it('throws (no form returned) when the durable row cannot be inserted', async () => {
    vi.mocked(pool.query).mockImplementation((async (q: string) => {
      if (q.includes('INSERT INTO wallet_topup_orders')) throw new Error('connection reset')
      return { rows: [{ name: 'Ravi', email: null, phone: '8888888888' }], rowCount: 1 }
    }) as never)
    await expect(createDriverTopupOrder(7n, 500)).rejects.toThrow('connection reset')
  })

  it('rejects non-numeric or sub-minimum amounts (a string must not reach toFixed)', async () => {
    await expect(createDriverTopupOrder(7n, 99)).rejects.toMatchObject({ httpStatus: 400 })
    await expect(createDriverTopupOrder(7n, '500' as unknown as number)).rejects.toMatchObject({ httpStatus: 400 })
    await expect(createDriverTopupOrder(7n, NaN)).rejects.toMatchObject({ httpStatus: 400 })
  })

  it('rejects a top-up above the maximum (no order row, no form)', async () => {
    await expect(createDriverTopupOrder(7n, 50_001)).rejects.toMatchObject({ httpStatus: 400 })
    await expect(createDriverTopupOrder(7n, 50_000)).resolves.toBeDefined()
  })

  it('rounds to whole paise', async () => {
    const out = await createDriverTopupOrder(7n, 100.005)
    expect(out.payu.fields['amount']).toMatch(/^100\.0[01]$/)
  })
})
