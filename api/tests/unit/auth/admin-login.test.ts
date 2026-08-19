import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/auth/auth.repository', () => ({
  findAdminByEmail: vi.fn(),
  touchAdminLogin: vi.fn(),
  storeRefreshToken: vi.fn(),
}))
vi.mock('@/lib/hash', () => ({ comparePassword: vi.fn() }))
vi.mock('@/lib/jwt', () => ({
  signAccessToken: vi.fn(() => 'access-token'),
  generateRefreshToken: vi.fn(() => 'refresh-token'),
  hashRefreshToken: vi.fn(() => 'hashed-refresh-token'),
  signPendingTotpToken: vi.fn(() => 'pending-totp-token'),
}))

import * as repo from '@/modules/auth/auth.repository'
import { comparePassword } from '@/lib/hash'
import { adminLogin } from '@/modules/auth/auth.service'

describe('adminLogin', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws AUTH_OTP_INVALID for an unknown email (does not leak "email not found" vs "wrong password")', async () => {
    vi.mocked(repo.findAdminByEmail).mockResolvedValue(null)

    await expect(adminLogin('nobody@ocar.example', 'whatever', null)).rejects.toMatchObject({
      appCode: 'AUTH_OTP_INVALID',
    })
    expect(comparePassword).not.toHaveBeenCalled()
  })

  it('throws AUTH_OTP_INVALID for a wrong password, using the same error as unknown email', async () => {
    vi.mocked(repo.findAdminByEmail).mockResolvedValue({
      id: '1', password_hash: 'hashed', totp_enabled: false,
    } as never)
    vi.mocked(comparePassword).mockResolvedValue(false)

    await expect(adminLogin('admin@ocar.example', 'wrong', null)).rejects.toMatchObject({
      appCode: 'AUTH_OTP_INVALID',
    })
    expect(repo.touchAdminLogin).not.toHaveBeenCalled()
  })

  it('when TOTP is enabled: correct password returns a pending token, issues NO session tokens, does not touch last_login_at', async () => {
    vi.mocked(repo.findAdminByEmail).mockResolvedValue({
      id: '1', password_hash: 'hashed', totp_enabled: true,
    } as never)
    vi.mocked(comparePassword).mockResolvedValue(true)

    const result = await adminLogin('admin@ocar.example', 'correct', '203.0.113.1')

    expect(result).toEqual({ pending: true, pendingToken: 'pending-totp-token' })
    expect(repo.touchAdminLogin).not.toHaveBeenCalled()
    expect(repo.storeRefreshToken).not.toHaveBeenCalled()
  })

  it('when TOTP is disabled: correct password issues a full session immediately', async () => {
    vi.mocked(repo.findAdminByEmail).mockResolvedValue({
      id: '1', code: 'ADM1', role: 'super_admin', totp_enabled: false, password_hash: 'hashed',
    } as never)
    vi.mocked(comparePassword).mockResolvedValue(true)

    const result = await adminLogin('admin@ocar.example', 'correct', '203.0.113.1')

    expect('pending' in result).toBe(false)
    expect(repo.touchAdminLogin).toHaveBeenCalledWith(BigInt(1), '203.0.113.1')
    expect(repo.storeRefreshToken).toHaveBeenCalledTimes(1)
  })
})
