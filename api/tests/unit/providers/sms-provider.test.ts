import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/config', () => ({
  config: { BULKSMSPLANS_API_ID: 'id', BULKSMSPLANS_API_PASSWORD: 'pw', BULKSMSPLANS_SENDER_ID: 'OCAR' },
}))

const { sendSms } = await import('@/providers/sms.provider')

describe('sendSms number normalisation', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ code: 200 }) })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const sentNumber = () => JSON.parse(fetchMock.mock.calls[0]![1].body).number as string

  it.each([
    ['+919876543210', '9876543210'],
    ['919876543210', '9876543210'],
    ['9876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    // Regression: a valid 10-digit number starting with 91 must not lose its prefix
    ['9123456789', '9123456789'],
    ['+919123456789', '9123456789'],
  ])('%s -> %s', async (input, expected) => {
    await sendSms(input, 'hi')
    expect(sentNumber()).toBe(expected)
  })

  it('throws when the vendor rejects the send', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ code: 400, message: 'bad' }) })
    await expect(sendSms('9876543210', 'hi')).rejects.toThrow('bad')
  })
})
