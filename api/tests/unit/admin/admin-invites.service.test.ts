import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

const repo = vi.hoisted(() => ({
  adminEmailExists: vi.fn(), findPendingInviteByEmail: vi.fn(), createInvite: vi.fn(), revokePendingInvite: vi.fn(),
  findByTokenHash: vi.fn(), redeemInvite: vi.fn(), listInvites: vi.fn(),
}))
const queueAdd = vi.hoisted(() => vi.fn())
const audit = vi.hoisted(() => vi.fn())
const policy = vi.hoisted(() => vi.fn())
vi.mock('@/modules/admin-invites/admin-invites.repository', () => repo)
vi.mock('@/jobs/queues', () => ({ notificationsQueue: { add: queueAdd } }))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: audit }))
vi.mock('@/lib/password-policy', () => ({ checkNewPassword: policy }))
vi.mock('@/lib/hash', async (orig) => ({ ...(await orig<typeof import('@/lib/hash')>()), hashPassword: async () => 'bcrypt-hash' }))

import { createInvite, redeemInvite, revokeInvite } from '@/modules/admin-invites/admin-invites.service'

// Value: protects=inviting is refused for someone who is already an admin or already has a live invite, the stored token is only a hash,
// every invite event leaves an audit record naming who did it, and activating checks the invite BEFORE looking at the password and never
// consumes the invite for a weak one; fails_when=an existing admin gets an email, the raw token is stored, an audit record is missing or
// names the wrong person, the password policy runs for someone without a live invite (a breach-list oracle), or a weak password burns the
// invite; why_new=none of this was checked or audited; seam=repository, queue, audit and password policy are replaced;
// no_claim=SQL (tests/integration/admin-invites.test.ts runs the real queries).

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))
const invite = { id: '41', email: 'new@ocar.test', role: 'ops_admin', invited_by: '7', status: 'pending', expires_at: new Date(Date.now() + 3600_000) }

describe('createInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repo.adminEmailExists.mockResolvedValue(false)
    repo.findPendingInviteByEmail.mockResolvedValue(null)
    repo.createInvite.mockResolvedValue(invite)
  })
  const params = { email: 'new@ocar.test', role: 'ops_admin' as const, invitedBy: 7n, ipAddress: '1.2.3.4' }

  it('refuses someone who is already an admin: nothing stored, no email, no audit', async () => {
    repo.adminEmailExists.mockResolvedValue(true)
    await expect(createInvite(params)).rejects.toMatchObject({ httpStatus: 409, appCode: 'ADMIN_ALREADY_EXISTS' })
    expect(repo.createInvite).not.toHaveBeenCalled()
    expect(queueAdd).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('treats " New@OCAR.test " and "new@ocar.test" as the same person everywhere (the shared validate() does not clean the body)', async () => {
    await createInvite({ ...params, email: '  New@OCAR.test ' })
    expect(repo.adminEmailExists).toHaveBeenCalledWith('new@ocar.test')
    expect(repo.findPendingInviteByEmail).toHaveBeenCalledWith('new@ocar.test')
    expect(repo.createInvite.mock.calls[0]![0]).toMatchObject({ email: 'new@ocar.test' })
    expect(queueAdd.mock.calls[0]![1]).toMatchObject({ email: 'new@ocar.test' })
  })

  it('refuses a second live invite for the same email', async () => {
    repo.findPendingInviteByEmail.mockResolvedValue(invite)
    await expect(createInvite(params)).rejects.toMatchObject({ httpStatus: 409, appCode: 'ADMIN_INVITE_DUPLICATE' })
    expect(repo.createInvite).not.toHaveBeenCalled()
  })

  it('stores only the hash of the token, emails the raw one, and audits who invited whom as what', async () => {
    await createInvite(params)
    const stored = repo.createInvite.mock.calls[0]![0] as { tokenHash: string; expiresAt: Date }
    const [name, job] = queueAdd.mock.calls[0]! as [string, { rawToken: string; email: string }]
    expect(name).toBe('admin_invite_email')
    expect(job.email).toBe('new@ocar.test')
    expect(stored.tokenHash).toBe(sha256(job.rawToken)) // the database holds the hash...
    expect(json(stored)).not.toContain(job.rawToken) // ...never the token itself
    expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(47 * 3600_000)

    expect(audit).toHaveBeenCalledTimes(1)
    const a = audit.mock.calls[0]![0]
    expect(a).toMatchObject({ adminId: 7n, action: 'admins.invite_create', targetTable: 'admin_invites', targetId: 41n, ipAddress: '1.2.3.4' })
    expect(a.afterState).toMatchObject({ email: 'new@ocar.test', role: 'ops_admin' })
    expect(json(a)).not.toContain(job.rawToken) // the audit log must never hold the token either
  })
})

describe('revokeInvite', () => {
  beforeEach(() => vi.clearAllMocks())

  it('an invite that is not pending is a 404 and is not audited', async () => {
    repo.revokePendingInvite.mockResolvedValue(null)
    await expect(revokeInvite(41n, 7n, null)).rejects.toMatchObject({ httpStatus: 404 })
    expect(audit).not.toHaveBeenCalled()
  })

  it('records who revoked which invite', async () => {
    repo.revokePendingInvite.mockResolvedValue({ ...invite, status: 'revoked' })
    await revokeInvite(41n, 9n, '5.6.7.8')
    expect(audit.mock.calls[0]![0]).toMatchObject({
      adminId: 9n, action: 'admins.invite_revoke', targetTable: 'admin_invites', targetId: 41n, ipAddress: '5.6.7.8',
      beforeState: { status: 'pending', email: 'new@ocar.test' }, afterState: { status: 'revoked' },
    })
  })
})

describe('redeemInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repo.findByTokenHash.mockResolvedValue(invite)
    policy.mockResolvedValue(null)
    repo.redeemInvite.mockResolvedValue({ admin: { id: '88', code: 'ADM000088', email: 'new@ocar.test', role: 'ops_admin' }, inviteId: '41', invitedBy: '7' })
  })

  it('an unknown, used, revoked or expired invite is the same generic error, and the password is never looked at', async () => {
    for (const row of [null, { ...invite, status: 'accepted' }, { ...invite, status: 'revoked' }, { ...invite, status: 'expired' }, { ...invite, expires_at: new Date(Date.now() - 1000) }]) {
      repo.findByTokenHash.mockResolvedValue(row)
      await expect(redeemInvite('tok', 'a-very-long-password-1', null)).rejects.toMatchObject({ httpStatus: 400, appCode: 'ADMIN_INVITE_INVALID' })
    }
    expect(policy).not.toHaveBeenCalled() // no live invite = no way to probe the breach list through this endpoint
    expect(repo.redeemInvite).not.toHaveBeenCalled()
  })

  it('a weak password is a 422 with its reason, and the invite is NOT used up', async () => {
    policy.mockResolvedValue('That password has appeared in a data breach.')
    await expect(redeemInvite('tok', 'weak-but-long-enough-1', null)).rejects.toMatchObject({ httpStatus: 422, appCode: 'WEAK_PASSWORD', message: expect.stringContaining('data breach') })
    expect(policy).toHaveBeenCalledWith('weak-but-long-enough-1', { email: 'new@ocar.test' })
    expect(repo.redeemInvite).not.toHaveBeenCalled()
  })

  it('creates the account, audits the acceptance as the new admin (with who invited them), and returns only the public fields', async () => {
    const admin = await redeemInvite('tok', 'a-very-long-password-1', '9.9.9.9')
    expect(admin).toEqual({ id: '88', code: 'ADM000088', email: 'new@ocar.test', role: 'ops_admin' }) // no inviteId / invitedBy leaks out
    expect(repo.redeemInvite).toHaveBeenCalledWith({ tokenHash: sha256('tok'), passwordHash: 'bcrypt-hash' })
    expect(audit.mock.calls[0]![0]).toMatchObject({
      adminId: 88n, action: 'admins.invite_accept', targetTable: 'admins', targetId: 88n, ipAddress: '9.9.9.9',
      afterState: { email: 'new@ocar.test', role: 'ops_admin', inviteId: '41', invitedBy: '7' },
    })
  })

  it('a token used by someone else a moment earlier (the row changed under us) is the generic error and is not audited', async () => {
    repo.redeemInvite.mockResolvedValue(null)
    await expect(redeemInvite('tok', 'a-very-long-password-1', null)).rejects.toMatchObject({ httpStatus: 400 })
    expect(audit).not.toHaveBeenCalled()
  })
})
