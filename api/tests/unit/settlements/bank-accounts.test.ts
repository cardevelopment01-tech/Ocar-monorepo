import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCipheriv, randomBytes } from 'crypto'

// Mirrors bank-accounts.service.ts's own encryptAccountNumber (not exported)
// so the fund-account tests can produce an account_number_enc value that
// decryptAccountNumber (which IS exported and exercised for real here) can
// actually round-trip, using the same fixed test key as the config mock below.
function testEncryptAccountNumber(accountNumber: string): string {
  const key = Buffer.from('0'.repeat(64), 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(accountNumber, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':')
}

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

import { addBankAccount, setBankAccountStatus } from '@/modules/payments/submodules/settlements/bank-accounts.service'

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

describe('setBankAccountStatus (live gateway, keys configured)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.unstubAllGlobals()
    vi.doMock('@/config', () => ({
      config: {
        RAZORPAY_KEY_ID: 'rzp_test_live',
        RAZORPAY_KEY_SECRET: 'secret',
        BANK_ACCOUNT_ENCRYPTION_KEY: '0'.repeat(64),
      },
    }))
    vi.doMock('@/db/client', () => ({
      pool: { query: (...args: unknown[]) => poolQuery(...args) },
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('success: creates a contact then a fund account, stores gateway_fund_account_id, then flips status', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'cont_1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'fa_1' }) })
    vi.stubGlobal('fetch', fetchMock)

    const accountNumberEnc = testEncryptAccountNumber('1234567890')
    poolQuery
      .mockResolvedValueOnce({ rows: [{ driver_id: '42', account_holder_name: 'Test Driver', ifsc: 'HDFC0001234', account_number_enc: accountNumberEnc }] }) // account lookup
      .mockResolvedValueOnce({ rowCount: 1 }) // gateway_fund_account_id UPDATE
      .mockResolvedValueOnce({ rowCount: 1 }) // status UPDATE

    const { setBankAccountStatus: setStatus } = await import(
      '@/modules/payments/submodules/settlements/bank-accounts.service'
    )

    const result = await setStatus(BigInt(5), 'verified')
    expect(result).toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [contactUrl, contactOpts] = fetchMock.mock.calls[0]
    expect(contactUrl).toBe('https://api.razorpay.com/v1/contacts')
    expect(JSON.parse(contactOpts.body).reference_id).toBe('42')

    const [fundUrl, fundOpts] = fetchMock.mock.calls[1]
    expect(fundUrl).toBe('https://api.razorpay.com/v1/fund_accounts')
    const fundBody = JSON.parse(fundOpts.body)
    expect(fundBody.contact_id).toBe('cont_1')
    expect(fundBody.account_type).toBe('bank_account')
    expect(fundBody.bank_account.ifsc).toBe('HDFC0001234')
    expect(fundBody.bank_account.account_number).toBe('1234567890')

    const updateCall = poolQuery.mock.calls[1] as [string, unknown[]]
    expect(updateCall[0]).toContain('gateway_fund_account_id')
    expect(updateCall[1]).toEqual([BigInt(5), 'fa_1'])
  })

  it('failure: contact creation fails, does not mark the account verified', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'Invalid contact' })
    vi.stubGlobal('fetch', fetchMock)

    poolQuery.mockResolvedValueOnce({
      rows: [{ driver_id: '42', account_holder_name: 'Test Driver', ifsc: 'HDFC0001234', account_number_enc: 'ENC' }],
    })

    const { setBankAccountStatus: setStatus } = await import(
      '@/modules/payments/submodules/settlements/bank-accounts.service'
    )
    const result = await setStatus(BigInt(5), 'verified')
    expect(result.ok).toBe(false)

    // Only the account lookup ran — no status UPDATE, no gateway_fund_account_id UPDATE.
    expect(poolQuery).toHaveBeenCalledTimes(1)
  })
})
