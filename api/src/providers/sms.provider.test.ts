import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/config', () => ({ config: { BULKSMSPLANS_API_ID: 'id', BULKSMSPLANS_API_PASSWORD: 'pw', BULKSMSPLANS_SENDER_ID: 'OCAR', NODE_ENV: 'production', ALLOW_REAL_SMS: 'false' } }))
const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: logs }))

import { config } from '@/config'
import { isRealSendingAllowed, isSyntheticPhone, pickProviderFields, sendSms } from './sms.provider'

afterEach(() => { vi.unstubAllGlobals(); logs.info.mockClear(); logs.warn.mockClear() })

describe('isSyntheticPhone', () => {
  it('matches the load-test blocks in any common format', () => {
    for (const p of ['+919999000001', '9999050000', '+91 99990 00123', '+918888000400', '8888000001']) {
      expect(isSyntheticPhone(p)).toBe(true)
    }
  })

  it('does not match real-looking numbers', () => {
    for (const p of ['+918093630642', '+919876543210', '+919999050001', '+918888000401', '+919990000001', '9999000000']) {
      expect(isSyntheticPhone(p)).toBe(false)
    }
  })
})

describe('the not-production lock (a scratch server with real credentials must not spend money)', () => {
  const cfg = config as unknown as { NODE_ENV: string; ALLOW_REAL_SMS: string }
  afterEach(() => { cfg.NODE_ENV = 'production'; cfg.ALLOW_REAL_SMS = 'false' })

  it('outside production nothing is sent, even with credentials, and the provider is never called', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    for (const env of ['development', 'test', 'staging']) {
      cfg.NODE_ENV = env
      expect(isRealSendingAllowed()).toBe(false)
      expect(await sendSms('+918093630642', 'hi')).toEqual({ skipped: 'not-production' })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ALLOW_REAL_SMS=true is the deliberate opt-in outside production; production needs nothing', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 200, message: 'ok' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    cfg.NODE_ENV = 'development'; cfg.ALLOW_REAL_SMS = 'true'
    expect(isRealSendingAllowed()).toBe(true)
    await sendSms('+918093630642', 'hi')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    cfg.NODE_ENV = 'production'; cfg.ALLOW_REAL_SMS = 'false'
    expect(isRealSendingAllowed()).toBe(true)
  })
})

describe('sendSms', () => {
  it('never calls the provider for a synthetic phone', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await sendSms('+919999000001', 'hi')
    await sendSms('+918888000001', 'hi')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still sends to a real phone', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ code: 200 }) })
    vi.stubGlobal('fetch', fetchMock)
    await sendSms('+918093630642', 'hi')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('returns the vendor fields and logs one sms.sent line with the last 4 digits only', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ code: 200, message: 'SMS Sent', msgid: 'abc123', balance: 42 }) })
    vi.stubGlobal('fetch', fetchMock)
    const res = await sendSms('+918093630642', 'Your Ocar login OTP is 123456.', '193042')
    expect(res).toMatchObject({ http_status: 200, code: 200, msgid: 'abc123', balance: 42 })
    const line = logs.info.mock.calls[0]![0] as Record<string, unknown>
    expect(line).toMatchObject({ event: 'sms.sent', phone_tail: '0642', template_id: '193042' })
    expect(JSON.stringify(line)).not.toContain('8093630642')
    expect(JSON.stringify(line)).not.toContain('123456')
  })

  it('says so when the vendor answers with a non-JSON page, instead of a JSON parse error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => '<html>Bad gateway</html>' }))
    await expect(sendSms('+918093630642', 'hi')).rejects.toThrow('non-JSON reply (HTTP 502)')
  })

  it('logs sms.rejected and throws the vendor message when the vendor refuses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ code: 405, message: 'Insufficient balance' }) }))
    await expect(sendSms('+918093630642', 'hi')).rejects.toThrow('Insufficient balance')
    expect(logs.warn.mock.calls[0]![0]).toMatchObject({ event: 'sms.rejected', provider: { code: 405 } })
  })

  // The two replies below are copied from the live endpoint (probed with deliberately fake credentials on 2026-11-22).
  it('logs which field failed when the vendor answers a validation error (HTTP 200, code 500, nested data)', async () => {
    const reply = { code: 500, message: 'Validation Error.', data: { api_id: ['The api id field is required.'] } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(reply) }))
    await expect(sendSms('+918093630642', 'hi')).rejects.toThrow('Validation Error.')
    expect(logs.warn.mock.calls[0]![0]).toMatchObject({
      event: 'sms.rejected', http_status: 200, provider: { code: 500, message: 'Validation Error.' },
      provider_detail: '{"api_id":["The api id field is required."]}',
    })
  })

  it('treats bad credentials (HTTP 403, code 500 "Access Denied!") as a rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => JSON.stringify({ code: 500, message: 'Access Denied!' }) }))
    await expect(sendSms('+918093630642', 'hi')).rejects.toThrow('Access Denied!')
    expect(logs.warn.mock.calls[0]![0]).toMatchObject({ event: 'sms.rejected', http_status: 403 })
    expect(logs.warn.mock.calls[0]![0]).not.toHaveProperty('provider_detail')
  })

  it('never logs vendor detail that echoes the message text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ code: 500, message: 'bad', data: { message: ['Your OTP is 123456'] } }) }))
    await expect(sendSms('+918093630642', 'Your OTP is 123456')).rejects.toThrow('bad')
    expect(JSON.stringify(logs.warn.mock.calls[0]![0])).not.toContain('123456')
  })
})

describe('pickProviderFields', () => {
  it('drops any field that echoes the message text, so an OTP never reaches a log or table', () => {
    const msg = 'Your Ocar login OTP is 123456. Valid for 10 minutes.'
    expect(pickProviderFields({ code: 200, status: 'OK', echo: msg, preview: 'Your Ocar login OTP is 123456.', ref: 'r1' }, msg))
      .toEqual({ code: 200, status: 'OK', ref: 'r1' })
  })
  it('keeps only top-level scalars of a sane size', () => {
    expect(pickProviderFields({ code: 200, nested: { a: 1 }, list: [1], big: 'x'.repeat(201) }, 'hi')).toEqual({ code: 200 })
    expect(pickProviderFields('nope', 'hi')).toEqual({})
  })
})
