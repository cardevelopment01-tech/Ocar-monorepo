import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/config', () => ({ config: { BULKSMSPLANS_API_ID: 'id', BULKSMSPLANS_API_PASSWORD: 'pw', BULKSMSPLANS_SENDER_ID: 'OCAR' } }))

import { isSyntheticPhone, sendSms } from './sms.provider'

afterEach(() => { vi.unstubAllGlobals() })

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

describe('sendSms', () => {
  it('never calls the provider for a synthetic phone', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await sendSms('+919999000001', 'hi')
    await sendSms('+918888000001', 'hi')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still sends to a real phone', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 200 }) })
    vi.stubGlobal('fetch', fetchMock)
    await sendSms('+918093630642', 'hi')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
