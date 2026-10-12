import { describe, it, expect, vi, beforeEach } from 'vitest'

const cfg = vi.hoisted(() => ({
  BULKSMSPLANS_API_ID: '', BULKSMSPLANS_API_PASSWORD: '', BULKSMSPLANS_SENDER_ID: 'S',
}))
vi.mock('@/config', () => ({ config: cfg }))

import { isSmsBypassActive, sendSms } from '@/providers/sms.provider'

describe('SMS bypass visibility', () => {
  beforeEach(() => { cfg.BULKSMSPLANS_API_ID = ''; cfg.BULKSMSPLANS_API_PASSWORD = '' })

  it('is active whenever either vendor credential is missing', () => {
    expect(isSmsBypassActive()).toBe(true)
    cfg.BULKSMSPLANS_API_ID = 'id'
    expect(isSmsBypassActive()).toBe(true)
    cfg.BULKSMSPLANS_API_PASSWORD = 'pw'
    expect(isSmsBypassActive()).toBe(false)
  })

  it('in bypass mode sendSms resolves without calling the vendor and never logs the message body (it carries OTPs)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(sendSms('+919999999999', 'Your OTP is 123456')).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls)).not.toContain('123456')
    log.mockRestore()
    fetchSpy.mockRestore()
  })
})
