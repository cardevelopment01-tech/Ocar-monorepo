import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/config', () => ({
  config: { PAYU_KEY: 'KEY', PAYU_SALT: 'SALT', PAYU_ENV: 'test', API_BASE_URL: 'https://api.example', NODE_ENV: 'test' },
}))
const { query, redisSet, getCfg, findPurchase, settle } = vi.hoisted(() => ({
  query: vi.fn(), redisSet: vi.fn(), getCfg: vi.fn(), findPurchase: vi.fn(), settle: vi.fn(),
}))
vi.mock('@/db/client', () => ({ pool: { query } }))
vi.mock('@/db/redis', () => ({ client: { set: redisSet } }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) } }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: getCfg }))
vi.mock('@/modules/packages/packages.repository', () => ({ findPurchaseByTxnId: findPurchase }))
vi.mock('@/modules/payments/payments.service', () => ({ settlePayuTxn: settle }))

import { signSdkHash, sdkParams, confirmSdkPayment, assertMobilePaymentsEnabled } from '@/modules/payments/payu-sdk'

const sha = (s: string): string => crypto.createHash('sha512').update(s).digest('hex')
const DATE = 'Thu, 08 Oct 2026 14:05:34 GMT'
const DRIVER = 7n

// The web/SDK request hash for the stored order: key|txn|amount|info|first|email|udf1..5|||||| + salt
const paymentHash = (txn: string, amount: string, info: string): string =>
  sha(['KEY', txn, amount, info, 'Asha', 'a@b.co', '', '', '', '', '', '', '', '', '', '', 'SALT'].join('|'))

function ownTopup(status = 'pending', amount = '500.00'): void {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM wallet_topup_orders')) return { rows: [{ amount, status }] }
    if (sql.includes('FROM drivers')) return { rows: [{ name: 'Asha', email: 'a@b.co', phone: '+919999999999' }] }
    return { rows: [] }
  })
}

const rejects = async (p: Promise<unknown>, status: number): Promise<void> => {
  await expect(p).rejects.toMatchObject({ httpStatus: status })
}

describe('signSdkHash', () => {
  beforeEach(() => { query.mockReset(); findPurchase.mockReset(); ownTopup() })

  it('signs the exact get_sdk_configuration string, nothing else', async () => {
    const s = 'KEY|get_sdk_configuration|GET|'
    expect(await signSdkHash(DRIVER, 'get_sdk_configuration', s)).toBe(sha(s + 'SALT'))
    await rejects(signSdkHash(DRIVER, 'get_sdk_configuration', 'KEY|get_sdk_configuration|POST|'), 400)
  })

  it('payment_source signs the STORED order, ignoring the client amount', async () => {
    const expected = paymentHash('Wtxn', '500.00', 'Ocar wallet top-up')
    const honest = 'KEY|Wtxn|500|Ocar wallet top-up|Asha|a@b.co|||||||||||'
    const tampered = 'KEY|Wtxn|1|Ocar wallet top-up|Asha|a@b.co|||||||||||'
    expect(await signSdkHash(DRIVER, 'payment_source', honest)).toBe(expected)
    expect(await signSdkHash(DRIVER, 'payment_source', tampered)).toBe(expected)
  })

  it('payment_source refuses unknown, completed and foreign orders and a wrong key', async () => {
    ownTopup('completed')
    await rejects(signSdkHash(DRIVER, 'payment_source', 'KEY|Wtxn|500|x|y|z|'), 404)
    query.mockResolvedValue({ rows: [] }) // not this driver's / unknown
    await rejects(signSdkHash(DRIVER, 'payment_source', 'KEY|Wother|500|x|y|z|'), 404)
    await rejects(signSdkHash(DRIVER, 'payment_source', 'OTHERKEY|Wtxn|500|x|y|z|'), 400)
    await rejects(signSdkHash(DRIVER, 'payment_source', 'KEY|Rride1|500|x|y|z|'), 404) // ride txns are never signed here
  })

  it('package orders use the tier-based productinfo and need the owner', async () => {
    findPurchase.mockResolvedValue({ driver_id: '7', package_tier_id: '3', amount: '999.00', status: 'pending' })
    expect(await signSdkHash(DRIVER, 'payment_source', 'KEY|Ptxn|999|x|y|z|')).toBe(paymentHash('Ptxn', '999.00', 'Ocar package 3'))
    findPurchase.mockResolvedValue({ driver_id: '8', package_tier_id: '3', amount: '999.00', status: 'pending' })
    await rejects(signSdkHash(DRIVER, 'payment_source', 'KEY|Ptxn|999|x|y|z|'), 404)
  })

  it('get_checkout_details needs the caller\'s txn and the stored amount', async () => {
    const mk = (txn: string, amount: number): string =>
      `KEY|get_checkout_details|${JSON.stringify({ transactionDetails: { amount, txnId: txn } })}|`
    expect(await signSdkHash(DRIVER, 'get_checkout_details', mk('Wtxn', 500))).toBe(sha(mk('Wtxn', 500) + 'SALT'))
    await rejects(signSdkHash(DRIVER, 'get_checkout_details', mk('Wtxn', 5)), 404)
    query.mockResolvedValue({ rows: [] })
    await rejects(signSdkHash(DRIVER, 'get_checkout_details', mk('Wtxn', 500)), 404)
    await rejects(signSdkHash(DRIVER, 'get_checkout_details', 'KEY|get_checkout_details|not json|'), 400)
  })

  it.each(['get_all_offer_details', 'quickPayEvent', 'device_id'])('%s signs only {json}|<date>|', async (name) => {
    const s = `{"amount":100}|${DATE}|`
    expect(await signSdkHash(DRIVER, name, s)).toBe(sha(s + 'SALT'))
    await rejects(signSdkHash(DRIVER, name, '{"amount":100}'), 400)
    await rejects(signSdkHash(DRIVER, name, `{not json}|${DATE}|`), 400)
  })

  it('binBaseDetails (card BIN lookup) needs the caller txn and stored amount', async () => {
    const mk = (txn: string, amount: string): string =>
      `${JSON.stringify({ cardNumber: '5123456789012346', amount, txnId: txn, merchantKey: 'KEY' })}|${DATE}|`
    expect(await signSdkHash(DRIVER, 'binBaseDetails', mk('Wtxn', '500.00'))).toBe(sha(mk('Wtxn', '500.00') + 'SALT'))
    await rejects(signSdkHash(DRIVER, 'binBaseDetails', mk('Wtxn', '1.00')), 404)
    query.mockResolvedValue({ rows: [] })
    await rejects(signSdkHash(DRIVER, 'binBaseDetails', mk('Wother', '500.00')), 404)
    await rejects(signSdkHash(DRIVER, 'binBaseDetails', '{"cardNumber":"1"}'), 400)
  })

  it('refuses duplicate txnId/amount keys (parser differential) and loose amount forms', async () => {
    const dup = `KEY|get_checkout_details|{"transactionDetails":{"txnId":"Wvictim","amount":1},"transactionDetails":{"txnId":"Wtxn","amount":500}}|`
    await rejects(signSdkHash(DRIVER, 'get_checkout_details', dup), 400)
    const mk = (amount: unknown): string => `KEY|get_checkout_details|${JSON.stringify({ transactionDetails: { amount, txnId: 'Wtxn' } })}|`
    for (const a of ['1e2', ' 500 ', true, null]) await rejects(signSdkHash(DRIVER, 'get_checkout_details', mk(a)), 404)
    const bin = `{"txnId":"Wvictim","amount":"1.00","txnId":"Wtxn","amount":"500.00"}|${DATE}|`
    await rejects(signSdkHash(DRIVER, 'binBaseDetails', bin), 400)
  })

  it('cannot be used as a signing oracle for money-path or API commands', async () => {
    const payment = 'KEY|Wtxn|1|Ocar wallet top-up|Asha|a@b.co|||||||||||'
    // a payment string smuggled through a JSON-dated name
    await rejects(signSdkHash(DRIVER, 'quickPayEvent', `${payment}${DATE}|`), 400)
    await rejects(signSdkHash(DRIVER, 'get_all_offer_details', payment), 400)
    // names we never allow, whatever the string
    for (const name of ['verify_payment', 'cancel_refund_transaction', 'payment', 'check_isDomestic', 'constructor', '']) {
      await rejects(signSdkHash(DRIVER, name, 'KEY|verify_payment|Wtxn|'), 400)
    }
    // shapes and sizes
    await rejects(signSdkHash(DRIVER, 'get_sdk_configuration', undefined), 400)
    await rejects(signSdkHash(DRIVER, undefined, 'x'), 400)
    await rejects(signSdkHash(DRIVER, 'quickPayEvent', '{' + 'a'.repeat(2500) + `}|${DATE}|`), 400)
  })
})

describe('sdkParams', () => {
  const form = (over: Record<string, string> = {}) => ({
    action: 'https://test.payu.in/_payment',
    fields: { key: 'KEY', txnid: 'W7xabc', amount: '500.00', productinfo: 'Ocar wallet top-up', firstname: 'Asha',
      email: 'a@b.co', phone: '+91 99999-99999', surl: 'https://api/x', furl: 'https://api/x', hash: 'h', ...over },
  })
  it('maps the web form to SDK params, 10-digit phone, test environment, no hash/salt', () => {
    const p = sdkParams(form())
    expect(p).toMatchObject({ key: 'KEY', environment: '1', transactionId: 'W7xabc', amount: '500.00', phone: '9999999999' })
    expect(JSON.stringify(p)).not.toContain('SALT')
    expect(p).not.toHaveProperty('hash')
  })
  it('refuses a transaction id over the SDK limit of 25 characters', () => {
    expect(() => sdkParams(form({ txnid: 'W' + 'x'.repeat(25) }))).toThrow()
  })
})

describe('confirmSdkPayment', () => {
  beforeEach(() => { query.mockReset(); settle.mockReset(); redisSet.mockReset(); ownTopup('pending') })

  it('404s a txn the driver does not own, without calling PayU', async () => {
    query.mockResolvedValue({ rows: [] })
    await rejects(confirmSdkPayment(DRIVER, 'Wother'), 404)
    expect(settle).not.toHaveBeenCalled()
  })
  it('rejects bad input', async () => {
    await rejects(confirmSdkPayment(DRIVER, undefined), 400)
    await rejects(confirmSdkPayment(DRIVER, 'W' + 'x'.repeat(60)), 400)
  })
  it('answers a completed order from our own record without calling PayU', async () => {
    ownTopup('completed')
    expect(await confirmSdkPayment(DRIVER, 'Wtxn')).toEqual({ result: 'success' })
    expect(settle).not.toHaveBeenCalled()
    expect(redisSet).not.toHaveBeenCalled()
  })
  it('runs the verify-then-credit funnel and returns its result', async () => {
    redisSet.mockResolvedValue('OK')
    settle.mockResolvedValue({ kind: 'wallet', id: '7', result: 'success' })
    expect(await confirmSdkPayment(DRIVER, 'Wtxn')).toEqual({ result: 'success' })
    expect(settle).toHaveBeenCalledWith('Wtxn', { txnid: 'Wtxn' })
  })
  it('collapses a repeat inside the cooldown into pending, with no PayU call', async () => {
    redisSet.mockResolvedValue(null)
    expect(await confirmSdkPayment(DRIVER, 'Wtxn')).toEqual({ result: 'pending' })
    expect(settle).not.toHaveBeenCalled()
  })
})

describe('assertMobilePaymentsEnabled', () => {
  it('is off unless the flag is exactly "true"', async () => {
    getCfg.mockResolvedValue('false')
    await rejects(assertMobilePaymentsEnabled(), 403)
    getCfg.mockResolvedValue('true')
    await expect(assertMobilePaymentsEnabled()).resolves.toBeUndefined()
  })
})
