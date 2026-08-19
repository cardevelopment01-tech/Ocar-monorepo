import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin-invites/admin-invites.repository', () => ({
  findPendingInviteByEmail: vi.fn(),
  createInvite: vi.fn(),
}))
vi.mock('@/jobs/queues', () => ({ notificationsQueue: { add: vi.fn(() => Promise.resolve()) } }))
vi.mock('@/lib/hash', () => ({
  sha256: vi.fn(() => 'hashed-token'),
  hashPassword: vi.fn(),
}))

import * as repo from '@/modules/admin-invites/admin-invites.repository'
import { notificationsQueue } from '@/jobs/queues'
import { createInvite } from '@/modules/admin-invites/admin-invites.service'

describe('createInvite', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws ADMIN_INVITE_DUPLICATE when a pending invite already exists for the email, and never creates a second one', async () => {
    vi.mocked(repo.findPendingInviteByEmail).mockResolvedValue({ id: '1' } as never)

    await expect(
      createInvite({ email: 'ops@ocar.example', role: 'ops_admin' as never, invitedBy: 1n })
    ).rejects.toMatchObject({ appCode: expect.stringContaining('DUPLICATE') })
    expect(repo.createInvite).not.toHaveBeenCalled()
    expect(notificationsQueue.add).not.toHaveBeenCalled()
  })

  it('on success: persists the invite with a HASHED token (never the raw token) and enqueues exactly one invite email with the RAW token', async () => {
    vi.mocked(repo.findPendingInviteByEmail).mockResolvedValue(null)
    vi.mocked(repo.createInvite).mockResolvedValue({ id: '2', email: 'ops@ocar.example', role: 'ops_admin' } as never)

    const result = await createInvite({ email: 'ops@ocar.example', role: 'ops_admin' as never, invitedBy: 1n })

    expect(result).toEqual({ id: '2', email: 'ops@ocar.example', role: 'ops_admin' })
    const createArgs = vi.mocked(repo.createInvite).mock.calls[0]![0] as { tokenHash: string }
    expect(createArgs.tokenHash).toBe('hashed-token') // the sha256 mock's output, never the raw token
    expect(notificationsQueue.add).toHaveBeenCalledTimes(1)
    const [, jobPayload] = vi.mocked(notificationsQueue.add).mock.calls[0]!
    expect((jobPayload as { rawToken: string }).rawToken).not.toBe('hashed-token') // raw token goes to email, not the hash
  })
})
