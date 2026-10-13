import { describe, it, expect, vi, beforeEach } from 'vitest'

const queueAdd = vi.fn().mockResolvedValue(undefined)
vi.mock('@/jobs/queues', () => ({ notificationsQueue: { add: (...a: unknown[]) => queueAdd(...a) } }))
vi.mock('@/lib/otp', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  isVerifyLocked: vi.fn().mockResolvedValue(false),
  generateOtp: vi.fn(() => '111111'),
  hashOtp: vi.fn((o: string) => `hash:${o}`),
  storeOtp: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/modules/auth/auth.repository', () => ({ createOtpRequest: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/config', async (orig) => {
  const actual = await orig<typeof import('@/config')>()
  return { ...actual, config: { ...actual.config, REVIEW_PHONE: '+919999900001', REVIEW_OTP: '424242' } }
})

import * as otpLib from '@/lib/otp'
import { requestOtp } from '@/modules/auth/auth.service'
import { envSchemaChecked } from '@/config'

describe('requestOtp for the Play review account', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the fixed code and sends no SMS', async () => {
    const res = await requestOtp('+919999900001', 'driver', 'login')
    expect(res.otp).toBe('424242')
    expect(otpLib.storeOtp).toHaveBeenCalledWith('+919999900001', expect.anything(), expect.anything(), '424242')
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('still goes through the rate limit and lockout checks', async () => {
    vi.mocked(otpLib.checkRateLimit).mockResolvedValueOnce({ allowed: false } as never)
    await expect(requestOtp('+919999900001', 'user', 'login')).rejects.toMatchObject({ appCode: 'AUTH_OTP_RATE_LIMITED' })
  })

  it('any other number gets a random code and a real SMS', async () => {
    const res = await requestOtp('+919876543210', 'user', 'login')
    expect(res.otp).toBe('111111')
    expect(queueAdd).toHaveBeenCalledWith('otp_sms', expect.objectContaining({ phone: '+919876543210', otp: '111111' }), expect.anything())
  })
})

describe('REVIEW_PHONE / REVIEW_OTP config', () => {
  const base = { ...process.env } as Record<string, string>
  const parse = (extra: Record<string, string>) => envSchemaChecked.safeParse({ ...base, ...extra })

  it('is optional', () => {
    expect(parse({ REVIEW_PHONE: '', REVIEW_OTP: '' }).success).toBe(true)
  })
  it('must be set together', () => {
    expect(parse({ REVIEW_PHONE: '+919999900001', REVIEW_OTP: '' }).success).toBe(false)
    expect(parse({ REVIEW_PHONE: '', REVIEW_OTP: '424242' }).success).toBe(false)
  })
  it('validates the phone and code shape', () => {
    expect(parse({ REVIEW_PHONE: '9999900001', REVIEW_OTP: '424242' }).success).toBe(false)
    expect(parse({ REVIEW_PHONE: '+919999900001', REVIEW_OTP: '42' }).success).toBe(false)
    expect(parse({ REVIEW_PHONE: '+919999900001', REVIEW_OTP: '424242' }).success).toBe(true)
  })
})
