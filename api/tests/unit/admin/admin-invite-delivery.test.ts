import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

const cfg = vi.hoisted(() => ({ ADMIN_APP_URL: 'https://admin.ocar.example', NODE_ENV: 'production', ALLOW_DEV_EMAIL: 'false' }))
const send = vi.hoisted(() => vi.fn())
const mark = vi.hoisted(() => vi.fn())
vi.mock('@/config', () => ({ config: cfg }))
vi.mock('@/lib/email', () => ({ sendEmail: send }))
vi.mock('@/modules/admin-invites/admin-invites.repository', () => ({ markInviteEmail: mark }))

import { deliverAdminInviteEmail } from '@/modules/admin-invites/admin-invite-delivery'

// Value: protects=the admin page can say whether an invitation email went out and why not: success is recorded against that invite and that
// link, a failure only once no retry is left (a hiccup the retry fixes never shows as failed), the reason is kept, an old job or a failing
// status write can never turn a sent email into a failed one, and a late job for a replaced link cannot overwrite the new link's status;
// fails_when=a retryable failure is shown as failed, the reason is lost, the status write breaks sending, or the wrong link's row is updated;
// why_new=nothing recorded what happened to an invitation email; seam=the sender and the repository are replaced; no_claim=SQL
// (tests/integration/admin-invites.test.ts runs the real queries).

const WHEN = new Date('2026-11-25T09:30:00.000Z')

describe('deliverAdminInviteEmail (records what happened, so the page can say "email failed")', () => {
  const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
  const job = { email: 'new@ocar.example', rawToken: 'tok123', expiresAt: WHEN.toISOString(), inviterEmail: 'priya@ocar.example', role: 'ops_admin' as const, inviteId: '41' }
  beforeEach(() => {
    send.mockReset(); mark.mockReset()
    send.mockResolvedValue(undefined); mark.mockResolvedValue(undefined)
    Object.assign(cfg, { ADMIN_APP_URL: 'https://admin.ocar.example', NODE_ENV: 'production', ALLOW_DEV_EMAIL: 'false' })
  })

  it('a sent email is recorded as sent against that invite and that link (matched by the token hash)', async () => {
    await deliverAdminInviteEmail(job, false)
    expect(mark).toHaveBeenCalledTimes(1)
    expect(mark).toHaveBeenCalledWith({ id: 41n, tokenHash: sha('tok123'), status: 'sent' })
  })

  it('a failure on an attempt that will be retried is NOT recorded (a hiccup the retry fixes never shows as failed) but is still thrown', async () => {
    send.mockRejectedValue(new Error('421 try again'))
    await expect(deliverAdminInviteEmail(job, false)).rejects.toThrow('421 try again')
    expect(mark).not.toHaveBeenCalled()
  })

  it('the failure on the LAST attempt is recorded with the reason, and still thrown so the job is logged as failed', async () => {
    send.mockRejectedValue(new Error('535 5.7.8 Username and Password not accepted'))
    await expect(deliverAdminInviteEmail(job, true)).rejects.toThrow('535')
    expect(mark).toHaveBeenCalledWith({ id: 41n, tokenHash: sha('tok123'), status: 'failed', error: '535 5.7.8 Username and Password not accepted' })
  })

  it('a link that cannot work (production, localhost) is a recorded failure with its own reason', async () => {
    cfg.ADMIN_APP_URL = 'http://localhost:3002'
    await expect(deliverAdminInviteEmail(job, true)).rejects.toThrow(/ADMIN_APP_URL/)
    expect(mark).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: expect.stringContaining('ADMIN_APP_URL') }))
    expect(send).not.toHaveBeenCalled()
  })

  it('a job from before invites were tracked (no inviteId) still sends and records nothing', async () => {
    const { inviteId: _omit, ...old } = job
    void _omit
    await deliverAdminInviteEmail(old, true)
    expect(send).toHaveBeenCalledTimes(1)
    expect(mark).not.toHaveBeenCalled()
  })

  it('a failure to write the status can never turn an email that went out into a failed one', async () => {
    mark.mockRejectedValue(new Error('db down'))
    await expect(deliverAdminInviteEmail(job, false)).resolves.toBeUndefined()
    send.mockRejectedValue(new Error('smtp down'))
    await expect(deliverAdminInviteEmail(job, true)).rejects.toThrow('smtp down') // the original error, not the database one
  })
})
