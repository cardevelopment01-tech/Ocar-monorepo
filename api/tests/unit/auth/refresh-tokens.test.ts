import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/auth/auth.repository', () => ({
  findRefreshToken: vi.fn(),
  revokeRefreshTokenFamily: vi.fn(),
  findUserById: vi.fn(),
  findDriverById: vi.fn(),
  findAdminById: vi.fn(),
  rotateRefreshToken: vi.fn(),
}))
vi.mock('@/lib/jwt', () => ({
  signAccessToken: vi.fn(() => 'new-access-token'),
  generateRefreshToken: vi.fn(() => 'new-refresh-token'),
  hashRefreshToken: vi.fn(() => 'hashed-refresh-token'),
}))

import * as repo from '@/modules/auth/auth.repository'
import { refreshTokens } from '@/modules/auth/auth.service'

describe('refreshTokens', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws AUTH_TOKEN_INVALID for a token that does not exist', async () => {
    vi.mocked(repo.findRefreshToken).mockResolvedValue(null)

    await expect(refreshTokens('unknown-token')).rejects.toMatchObject({
      appCode: 'AUTH_TOKEN_INVALID',
    })
  })

  it('REUSE DETECTION: a token already marked used_at revokes the entire token family and rejects', async () => {
    vi.mocked(repo.findRefreshToken).mockResolvedValue({
      id: '1', principal_role: 'user', principal_id: '7',
      used_at: new Date('2026-01-01'), revoked_at: null,
      expires_at: new Date('2099-01-01'),
    } as never)

    await expect(refreshTokens('stolen-and-replayed-token')).rejects.toMatchObject({
      appCode: 'AUTH_TOKEN_INVALID',
    })
    expect(repo.revokeRefreshTokenFamily).toHaveBeenCalledTimes(1)
  })

  it('an expired-but-unused token also revokes the family and rejects', async () => {
    vi.mocked(repo.findRefreshToken).mockResolvedValue({
      id: '1', principal_role: 'user', principal_id: '7',
      used_at: null, revoked_at: null,
      expires_at: new Date('2020-01-01'),
    } as never)

    await expect(refreshTokens('expired-token')).rejects.toMatchObject({
      appCode: 'AUTH_TOKEN_INVALID',
    })
    expect(repo.revokeRefreshTokenFamily).toHaveBeenCalledTimes(1)
  })

  it('a valid, unused, unexpired token rotates cleanly and issues a new pair', async () => {
    vi.mocked(repo.findRefreshToken).mockResolvedValue({
      id: '1', principal_role: 'user', principal_id: '7',
      used_at: null, revoked_at: null,
      expires_at: new Date('2099-01-01'),
    } as never)
    vi.mocked(repo.findUserById).mockResolvedValue({ id: '7', code: 'USR7', status: 'active' } as never)
    vi.mocked(repo.rotateRefreshToken).mockResolvedValue(true as never)

    const result = await refreshTokens('valid-token')

    expect(result.tokens.accessToken).toBe('new-access-token')
    expect(result.tokens.refreshToken).toBe('new-refresh-token')
    expect(repo.revokeRefreshTokenFamily).not.toHaveBeenCalled()
  })

  it('when rotateRefreshToken reports a lost race (false), rejects rather than issuing tokens anyway', async () => {
    vi.mocked(repo.findRefreshToken).mockResolvedValue({
      id: '1', principal_role: 'user', principal_id: '7',
      used_at: null, revoked_at: null,
      expires_at: new Date('2099-01-01'),
    } as never)
    vi.mocked(repo.findUserById).mockResolvedValue({ id: '7', code: 'USR7', status: 'active' } as never)
    vi.mocked(repo.rotateRefreshToken).mockResolvedValue(false as never)

    await expect(refreshTokens('valid-token-racing-another-refresh')).rejects.toMatchObject({
      appCode: 'AUTH_TOKEN_INVALID',
    })
  })
})
