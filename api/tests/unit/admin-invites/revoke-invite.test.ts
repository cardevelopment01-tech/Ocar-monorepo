import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin-invites/admin-invites.repository', () => ({
  revokePendingInvite: vi.fn(),
}))

import * as repo from '@/modules/admin-invites/admin-invites.repository'
import { revokeInvite } from '@/modules/admin-invites/admin-invites.service'

describe('revokeInvite', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws NOT_FOUND when there is nothing to revoke (already revoked/redeemed/nonexistent)', async () => {
    vi.mocked(repo.revokePendingInvite).mockResolvedValue(null)

    await expect(revokeInvite(999n)).rejects.toMatchObject({
      appCode: expect.stringContaining('NOT_FOUND'),
    })
  })

  it('returns the revoked invite on success', async () => {
    vi.mocked(repo.revokePendingInvite).mockResolvedValue({ id: '1', status: 'revoked' } as never)

    const result = await revokeInvite(1n)

    expect(result).toEqual({ id: '1', status: 'revoked' })
  })
})
