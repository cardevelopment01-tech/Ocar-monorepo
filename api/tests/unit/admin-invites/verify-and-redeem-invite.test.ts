import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin-invites/admin-invites.repository', () => ({
  findByTokenHash: vi.fn(),
  redeemInvite: vi.fn(),
}))
vi.mock('@/lib/hash', () => ({
  sha256: vi.fn(() => 'hashed-token'),
  hashPassword: vi.fn(() => Promise.resolve('hashed-password')),
}))

import * as repo from '@/modules/admin-invites/admin-invites.repository'
import { verifyInviteToken, redeemInvite } from '@/modules/admin-invites/admin-invites.service'

describe('verifyInviteToken', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws ADMIN_INVITE_INVALID when no invite matches the token', async () => {
    vi.mocked(repo.findByTokenHash).mockResolvedValue(null)

    await expect(verifyInviteToken('bad-token')).rejects.toMatchObject({
      appCode: expect.stringContaining('INVALID'),
    })
  })

  it('throws ADMIN_INVITE_INVALID for an already-redeemed (non-pending) invite', async () => {
    vi.mocked(repo.findByTokenHash).mockResolvedValue({
      email: 'ops@ocar.example', role: 'ops_admin', status: 'redeemed',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    } as never)

    await expect(verifyInviteToken('used-token')).rejects.toMatchObject({
      appCode: expect.stringContaining('INVALID'),
    })
  })

  it('throws ADMIN_INVITE_INVALID for an expired invite, even if status is still "pending"', async () => {
    vi.mocked(repo.findByTokenHash).mockResolvedValue({
      email: 'ops@ocar.example', role: 'ops_admin', status: 'pending',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    } as never)

    await expect(verifyInviteToken('expired-token')).rejects.toMatchObject({
      appCode: expect.stringContaining('INVALID'),
    })
  })

  it('returns email + role for a valid pending, unexpired invite, without mutating anything', async () => {
    vi.mocked(repo.findByTokenHash).mockResolvedValue({
      email: 'ops@ocar.example', role: 'ops_admin', status: 'pending',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    } as never)

    const result = await verifyInviteToken('good-token')

    expect(result).toEqual({ email: 'ops@ocar.example', role: 'ops_admin' })
    expect(repo.redeemInvite).not.toHaveBeenCalled()
  })
})

describe('redeemInvite', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws ADMIN_INVITE_INVALID when the repository reports no matching redeemable invite (bad/reused/expired token)', async () => {
    vi.mocked(repo.redeemInvite).mockResolvedValue(null)

    await expect(redeemInvite('bad-token', 'NewPassw0rd!')).rejects.toMatchObject({
      appCode: expect.stringContaining('INVALID'),
    })
  })

  it('hashes the password before it ever reaches the repository (never passes the plaintext password through)', async () => {
    vi.mocked(repo.redeemInvite).mockResolvedValue({ id: '9', email: 'ops@ocar.example' } as never)

    await redeemInvite('good-token', 'NewPassw0rd!')

    const callArgs = vi.mocked(repo.redeemInvite).mock.calls[0]![0] as { passwordHash: string; tokenHash: string }
    expect(callArgs.passwordHash).toBe('hashed-password')
    expect(callArgs.tokenHash).toBe('hashed-token')
  })
})
