import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

const repo = vi.hoisted(() => ({
  adminEmailExists: vi.fn(), findAdminEmailById: vi.fn(), findPendingInviteByEmail: vi.fn(), createInvite: vi.fn(), revokePendingInvite: vi.fn(),
  findByTokenHash: vi.fn(), redeemInvite: vi.fn(), listInvites: vi.fn(),
  findInviteById: vi.fn(), reissueInvite: vi.fn(), resendBlocker: vi.fn(), markInviteEmail: vi.fn(),
}))
const queueAdd = vi.hoisted(() => vi.fn())
const audit = vi.hoisted(() => vi.fn())
const policy = vi.hoisted(() => vi.fn())
vi.mock('@/modules/admin-invites/admin-invites.repository', () => repo)
vi.mock('@/jobs/queues', () => ({ notificationsQueue: { add: queueAdd } }))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: audit }))
vi.mock('@/lib/password-policy', () => ({ checkNewPassword: policy }))
vi.mock('@/lib/hash', async (orig) => ({ ...(await orig<typeof import('@/lib/hash')>()), hashPassword: async () => 'bcrypt-hash' }))

import { createInvite, redeemInvite, resendInvite, revokeInvite } from '@/modules/admin-invites/admin-invites.service'

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
    repo.findAdminEmailById.mockResolvedValue('inviter@ocar.test')
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

  it('tells the email who invited them and as what, so it can be recognised as genuine; an inviter that cannot be found leaves that out', async () => {
    await createInvite(params)
    expect(repo.findAdminEmailById).toHaveBeenCalledWith(7n)
    expect(queueAdd.mock.calls[0]![1]).toMatchObject({ email: 'new@ocar.test', role: 'ops_admin', inviterEmail: 'inviter@ocar.test' })
    queueAdd.mockClear()
    repo.findAdminEmailById.mockResolvedValue(null)
    await createInvite(params)
    expect(queueAdd.mock.calls[0]![1]).not.toHaveProperty('inviterEmail')
    expect(queueAdd.mock.calls[0]![1]).toMatchObject({ role: 'ops_admin' })
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

describe('createInvite: the link, and an email that cannot be queued', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queueAdd.mockResolvedValue(undefined)
    repo.adminEmailExists.mockResolvedValue(false)
    repo.findAdminEmailById.mockResolvedValue('inviter@ocar.test')
    repo.findPendingInviteByEmail.mockResolvedValue(null)
    repo.createInvite.mockResolvedValue({ ...invite, email_status: 'queued', email_error: null })
    repo.markInviteEmail.mockResolvedValue(undefined)
  })
  const params = { email: 'new@ocar.test', role: 'ops_admin' as const, invitedBy: 7n, ipAddress: null }

  it('returns the activation link once, the same one the email carries, and the job knows which invite it belongs to', async () => {
    const { invite: created, link } = await createInvite(params)
    const job = queueAdd.mock.calls[0]![1] as { rawToken: string; inviteId: string }
    expect(link).toBe(`http://localhost:3002/accept-invite?token=${job.rawToken}`)
    expect(job.inviteId).toBe('41')
    expect(created.email_status).toBe('queued')
    expect(json(created)).not.toContain(job.rawToken) // the invite row itself never holds the token
  })

  it('if the email queue is down the invite is KEPT, marked "email failed" with the reason, and the link is still returned (copy it instead)', async () => {
    queueAdd.mockRejectedValue(new Error('redis down'))
    const { invite: created, link } = await createInvite(params)
    expect(created.email_status).toBe('failed')
    expect(created.email_error).toMatch(/could not be queued/)
    expect(link).toContain('/accept-invite?token=')
    expect(repo.markInviteEmail).toHaveBeenCalledWith(expect.objectContaining({ id: 41n, status: 'failed' }))
    expect(audit).toHaveBeenCalledTimes(1) // the invite was created and is audited
  })
})

describe('resendInvite', () => {
  const existing = { ...invite, status: 'pending', email_status: 'failed' }
  const reissued = { ...invite, status: 'pending', email_status: 'queued', email_error: null }
  beforeEach(() => {
    vi.clearAllMocks()
    queueAdd.mockResolvedValue(undefined)
    repo.findInviteById.mockResolvedValue(existing)
    repo.adminEmailExists.mockResolvedValue(false)
    repo.findAdminEmailById.mockResolvedValue('resender@ocar.test')
    repo.reissueInvite.mockResolvedValue(reissued)
    repo.markInviteEmail.mockResolvedValue(undefined)
  })

  it('issues a NEW link (only its hash is stored), restarts the 48 hours, and emails it naming the person who resent it', async () => {
    const { invite: out, link } = await resendInvite(41n, 9n, '1.2.3.4')
    const args = repo.reissueInvite.mock.calls[0]![0] as { id: bigint; tokenHash: string; expiresAt: Date; cooldownSeconds: number }
    const job = queueAdd.mock.calls[0]![1] as { rawToken: string; inviterEmail: string; inviteId: string; email: string; role: string }
    expect(args.id).toBe(41n)
    expect(args.tokenHash).toBe(sha256(job.rawToken)) // the database gets the hash of exactly the token that was emailed...
    expect(json(args)).not.toContain(job.rawToken) // ...never the token
    expect(args.expiresAt.getTime() - Date.now()).toBeGreaterThan(47 * 3600_000)
    expect(args.cooldownSeconds).toBe(60)
    expect(link).toBe(`http://localhost:3002/accept-invite?token=${job.rawToken}`)
    expect(job).toMatchObject({ email: 'new@ocar.test', role: 'ops_admin', inviteId: '41', inviterEmail: 'resender@ocar.test' })
    expect(out.email_status).toBe('queued')
  })

  it('audits who resent which invite, with what it was before; the audit record holds no token', async () => {
    await resendInvite(41n, 9n, '1.2.3.4')
    const a = audit.mock.calls[0]![0]
    expect(a).toMatchObject({ adminId: 9n, action: 'admins.invite_resend', targetTable: 'admin_invites', targetId: 41n, ipAddress: '1.2.3.4' })
    expect(a.beforeState).toMatchObject({ status: 'pending' })
    expect(a.afterState).toMatchObject({ status: 'pending', email: 'new@ocar.test', role: 'ops_admin' })
    expect(json(a)).not.toContain((queueAdd.mock.calls[0]![1] as { rawToken: string }).rawToken)
  })

  it('an invite that does not exist is a 404', async () => {
    repo.findInviteById.mockResolvedValue(null)
    await expect(resendInvite(41n, 9n, null)).rejects.toMatchObject({ httpStatus: 404 })
    expect(repo.reissueInvite).not.toHaveBeenCalled()
  })

  it('someone who is an admin by now gets no new link (it would only end in "already exists")', async () => {
    repo.adminEmailExists.mockResolvedValue(true)
    await expect(resendInvite(41n, 9n, null)).rejects.toMatchObject({ httpStatus: 409, appCode: 'ADMIN_ALREADY_EXISTS' })
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('an accepted or revoked invite cannot be resent (send a new one), and nothing is emailed or audited', async () => {
    repo.reissueInvite.mockResolvedValue(null)
    repo.resendBlocker.mockResolvedValue({ resendable: false, waitSeconds: 0 })
    await expect(resendInvite(41n, 9n, null)).rejects.toMatchObject({ httpStatus: 409, appCode: 'ADMIN_INVITE_NOT_RESENDABLE' })
    expect(queueAdd).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('a second resend within the minute is a 429 that says how long to wait', async () => {
    repo.reissueInvite.mockResolvedValue(null)
    repo.resendBlocker.mockResolvedValue({ resendable: true, waitSeconds: 42 })
    await expect(resendInvite(41n, 9n, null)).rejects.toMatchObject({ httpStatus: 429, appCode: 'ADMIN_INVITE_RESEND_TOO_SOON', message: 'Wait 42 seconds before resending' })
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('if the email queue is down the new link still exists and is returned, marked "email failed"', async () => {
    queueAdd.mockRejectedValue(new Error('redis down'))
    const { invite: out, link } = await resendInvite(41n, 9n, null)
    expect(out.email_status).toBe('failed')
    expect(link).toContain('/accept-invite?token=')
    expect(audit).toHaveBeenCalledTimes(1)
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
