import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/otp', () => ({
  checkRateLimit: vi.fn(),
  isVerifyLocked: vi.fn(),
  generateOtp: vi.fn(() => '1234'),
  hashOtp: vi.fn(() => 'hashed-1234'),
  storeOtp: vi.fn(),
}))
vi.mock('@/modules/auth/auth.repository', () => ({
  createOtpRequest: vi.fn(),
}))
vi.mock('@/jobs/queues', () => ({
  notificationsQueue: { add: vi.fn() },
}))

import * as otpLib from '@/lib/otp'
import * as repo from '@/modules/auth/auth.repository'
import { notificationsQueue } from '@/jobs/queues'
import { requestOtp } from '@/modules/auth/auth.service'

describe('requestOtp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(otpLib.checkRateLimit).mockResolvedValue({ allowed: true, remaining: 4 })
    vi.mocked(otpLib.isVerifyLocked).mockResolvedValue(false)
  })

  it('throws AUTH_OTP_RATE_LIMITED and never stores/sends an OTP when rate limit is exceeded', async () => {
    vi.mocked(otpLib.checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0 })

    await expect(requestOtp('9876543210', 'user', 'login')).rejects.toMatchObject({
      appCode: 'AUTH_OTP_RATE_LIMITED',
    })
    expect(otpLib.storeOtp).not.toHaveBeenCalled()
    expect(notificationsQueue.add).not.toHaveBeenCalled()
  })

  it('throws AUTH_OTP_LOCKED and never stores/sends an OTP when the phone is verify-locked', async () => {
    vi.mocked(otpLib.isVerifyLocked).mockResolvedValue(true)

    await expect(requestOtp('9876543210', 'user', 'login')).rejects.toMatchObject({
      appCode: 'AUTH_OTP_LOCKED',
    })
    expect(otpLib.storeOtp).not.toHaveBeenCalled()
    expect(notificationsQueue.add).not.toHaveBeenCalled()
  })

  it('on the happy path: stores the OTP, persists the request row, and enqueues exactly one SMS job', async () => {
    const result = await requestOtp('9876543210', 'driver', 'login')

    expect(result.otp).toBe('1234')
    expect(otpLib.storeOtp).toHaveBeenCalledWith('9876543210', 'login', 'driver', '1234')
    expect(repo.createOtpRequest).toHaveBeenCalledTimes(1)
    expect(notificationsQueue.add).toHaveBeenCalledTimes(1)
    expect(notificationsQueue.add).toHaveBeenCalledWith(
      'otp_sms',
      { phone: '9876543210', otp: '1234', type: 'auth' },
      expect.objectContaining({ attempts: 3 })
    )
  })
})
