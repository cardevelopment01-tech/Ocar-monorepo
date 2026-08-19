import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/otp', () => ({ consumeOtp: vi.fn() }))
vi.mock('@/modules/auth/auth.repository', () => ({
  findUserByPhone: vi.fn(),
  upsertUser: vi.fn(),
  findDriverByPhone: vi.fn(),
  upsertDriver: vi.fn(),
  storeRefreshToken: vi.fn(),
}))
vi.mock('@/lib/jwt', () => ({
  signAccessToken: vi.fn(() => 'access-token'),
  generateRefreshToken: vi.fn(() => 'refresh-token'),
  hashRefreshToken: vi.fn(() => 'hashed-refresh-token'),
}))

import * as otpLib from '@/lib/otp'
import * as repo from '@/modules/auth/auth.repository'
import { verifyOtp } from '@/modules/auth/auth.service'

describe('verifyOtp', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws AUTH_OTP_INVALID for a wrong code (not expired, not locked)', async () => {
    vi.mocked(otpLib.consumeOtp).mockResolvedValue({ success: false, attemptsLeft: 2 })

    await expect(verifyOtp('9876543210', '0000', 'user', 'login')).rejects.toMatchObject({
      appCode: 'AUTH_OTP_INVALID',
    })
    expect(repo.upsertUser).not.toHaveBeenCalled()
  })

  it('throws AUTH_OTP_EXPIRED when the OTP has expired', async () => {
    vi.mocked(otpLib.consumeOtp).mockResolvedValue({ success: false, expired: true })

    await expect(verifyOtp('9876543210', '1234', 'user', 'login')).rejects.toMatchObject({
      appCode: 'AUTH_OTP_EXPIRED',
    })
  })

  it('throws AUTH_OTP_LOCKED when the phone is locked out from repeated wrong attempts', async () => {
    vi.mocked(otpLib.consumeOtp).mockResolvedValue({ success: false, locked: true })

    await expect(verifyOtp('9876543210', '1234', 'user', 'login')).rejects.toMatchObject({
      appCode: 'AUTH_OTP_LOCKED',
    })
  })

  it('throws DRIVER_SUSPENDED for a suspended driver, even with a correct OTP', async () => {
    vi.mocked(otpLib.consumeOtp).mockResolvedValue({ success: true })
    vi.mocked(repo.findDriverByPhone).mockResolvedValue({ id: '5' } as never)
    vi.mocked(repo.upsertDriver).mockResolvedValue({
      id: '5', code: 'DRV5', status: 'suspended',
    } as never)

    await expect(verifyOtp('9876543210', '1234', 'driver', 'login')).rejects.toMatchObject({
      appCode: 'DRIVER_SUSPENDED',
    })
    expect(repo.storeRefreshToken).not.toHaveBeenCalled()
  })

  it('throws AUTH_FORBIDDEN for a suspended user, even with a correct OTP', async () => {
    vi.mocked(otpLib.consumeOtp).mockResolvedValue({ success: true })
    vi.mocked(repo.findUserByPhone).mockResolvedValue({ id: '7' } as never)
    vi.mocked(repo.upsertUser).mockResolvedValue({
      id: '7', code: 'USR7', status: 'suspended',
    } as never)

    await expect(verifyOtp('9876543210', '1234', 'user', 'login')).rejects.toMatchObject({
      appCode: 'AUTH_FORBIDDEN',
    })
    expect(repo.storeRefreshToken).not.toHaveBeenCalled()
  })

  it('on success: issues a token pair and reports isNew correctly for a first-time user', async () => {
    vi.mocked(otpLib.consumeOtp).mockResolvedValue({ success: true })
    vi.mocked(repo.findUserByPhone).mockResolvedValue(null) // no existing row → isNew
    vi.mocked(repo.upsertUser).mockResolvedValue({
      id: '7', code: 'USR7', status: 'active',
    } as never)

    const result = await verifyOtp('9876543210', '1234', 'user', 'login')

    expect(result.isNew).toBe(true)
    expect(result.tokens.accessToken).toBe('access-token')
    expect(result.tokens.refreshToken).toBe('refresh-token')
    expect(repo.storeRefreshToken).toHaveBeenCalledTimes(1)
  })
})
