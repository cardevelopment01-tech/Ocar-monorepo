import { describe, it, expect, vi } from 'vitest'

vi.mock('@/config', () => ({
  config: { PAYU_KEY: 'testkey', PAYU_SALT: 'testsalt', PAYU_ENV: 'test' },
}))

import {
  buildPayuForm, verifyPayuResponseHash, payuApiHash, toPaise, newTxnId,
  sanitizeFirstname, customerFor, payuConfigured, payuUrls,
} from '@/lib/payu'

const REQ_HASH =
  'b179e58b38ef3936d108e5fb7fde4232024655330d58e75951d0f426148e1b5bd70518bd36c7b50aa53fbb168d50b6b5b3843aad3a3d616f3e3faca22d565e12'
const RESP_HASH =
  'f166545f97ddb7a80f2a448bfe1e3888846b5225aea6eb448252c010c4af34e09f4e2f94e3a7b9dfb2e0d2cd6024d41aa30bb9ef8f0eae20b5392ac125eee2dd'
const RESP_HASH_AC =
  'a8f837d8a841e65e6c709d535d5ec2636ac80a965ea455dc0eeb66f1898a7000b3a2d77819c20bb69b4f0bc32b2d7be51c852393f6900493b5a9bf3357e69c6a'
const API_HASH =
  '69b1871d084bf6785327699919a2a2aac11025cdf9e89ce91e15544fcd69cefba18be379417a8826271751857553a648a145c41644dcb1fd110c641bed7ab4e6'

const customer = { name: 'Asha', email: 'a@b.in', phone: '9999999999' }

describe('buildPayuForm', () => {
  it('signs the documented request hash and never leaks the salt', () => {
    const form = buildPayuForm({
      txnId: 'R1xabc', amount: 500, productInfo: 'Ride 1', customer,
      returnUrl: 'https://api.example/api/v1/payments/payu/return',
    })
    expect(form.action).toBe('https://test.payu.in/_payment')
    expect(form.fields['hash']).toBe(REQ_HASH)
    expect(form.fields).toMatchObject({
      key: 'testkey', txnid: 'R1xabc', amount: '500.00', productinfo: 'Ride 1',
      firstname: 'Asha', email: 'a@b.in', phone: '9999999999',
      surl: 'https://api.example/api/v1/payments/payu/return',
      furl: 'https://api.example/api/v1/payments/payu/return',
      curl: 'https://api.example/api/v1/payments/payu/return',
    })
    expect(JSON.stringify(form)).not.toContain('testsalt')
  })
})

describe('verifyPayuResponseHash', () => {
  const base = {
    status: 'success', email: 'a@b.in', firstname: 'Asha', productinfo: 'Ride 1',
    amount: '500.00', txnid: 'R1xabc', key: 'testkey',
  }
  it('accepts a correctly signed response', () => {
    expect(verifyPayuResponseHash({ ...base, hash: RESP_HASH })).toBe(true)
  })
  it('accepts the additional_charges variant', () => {
    expect(verifyPayuResponseHash({ ...base, additional_charges: '12.50', hash: RESP_HASH_AC })).toBe(true)
  })
  it('rejects a tampered amount', () => {
    expect(verifyPayuResponseHash({ ...base, amount: '1.00', hash: RESP_HASH })).toBe(false)
  })
  it('rejects a tampered status (failure → success)', () => {
    expect(verifyPayuResponseHash({ ...base, status: 'failure', hash: RESP_HASH })).toBe(false)
  })
  it('rejects missing / empty / wrong-length hashes without throwing', () => {
    expect(verifyPayuResponseHash({ ...base })).toBe(false)
    expect(verifyPayuResponseHash({ ...base, hash: '' })).toBe(false)
    expect(verifyPayuResponseHash({ ...base, hash: 'abc' })).toBe(false)
  })
  it('ignores the posted key and hashes with OUR configured key', () => {
    // The vector was built with key=testkey (config). A posted key of 'otherkey'
    // must not change what is hashed, so the original hash still verifies.
    expect(verifyPayuResponseHash({ ...base, key: 'otherkey', hash: RESP_HASH })).toBe(true)
  })
})

describe('helpers', () => {
  it('payuApiHash matches sha512(key|command|var1|salt)', () => {
    expect(payuApiHash('verify_payment', 'R1xabc')).toBe(API_HASH)
  })
  it('toPaise converts decimal strings without float error', () => {
    expect(toPaise('500.00')).toBe(50000)
    expect(toPaise('0.1')).toBe(10)
    expect(toPaise('19.99')).toBe(1999)
    expect(toPaise('1234')).toBe(123400)
    expect(toPaise('1.005')).toBe(100) // truncates, never rounds up
  })
  it('newTxnId is alphanumeric, ≤25 chars, unique per call', () => {
    const a = newTxnId('R', BigInt(99999999))
    const b = newTxnId('R', BigInt(99999999))
    expect(a).toMatch(/^R99999999x[a-z0-9]+$/)
    expect(a.length).toBeLessThanOrEqual(25)
    expect(a).not.toBe(b)
  })
  it('sanitizeFirstname strips characters PayU rejects, with a fallback', () => {
    expect(sanitizeFirstname("Ásha O'Neil 123")).toBe('sha ONeil')
    expect(sanitizeFirstname('   ')).toBe('Customer')
    expect(sanitizeFirstname(null)).toBe('Customer')
    expect(sanitizeFirstname('A'.repeat(100)).length).toBe(60)
  })
  it('customerFor falls back to a deterministic email when none is on file', () => {
    expect(customerFor({ name: 'Asha', email: null, phone: '9999999999' }, 'user', 42n))
      .toEqual({ name: 'Asha', email: 'user42@ocarindia.com', phone: '9999999999' })
    expect(customerFor({ name: 'D', email: 'd@x.in', phone: null }, 'driver', 7n).phone).toBe('')
  })
  it('payuConfigured / payuUrls reflect config', () => {
    expect(payuConfigured()).toBe(true)
    expect(payuUrls().api).toBe('https://test.payu.in/merchant/postservice.php?form=2')
  })
})
