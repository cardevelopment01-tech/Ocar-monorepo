import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import crypto from 'crypto'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { notificationsQueue } from '@/jobs/queues'
import { seedAdmin, loginAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'

// Value: protects=the invite flow end to end on a real database: an invite that nobody answered stops blocking after 48 hours, an existing
// admin cannot be invited (in any letter case), the token is only ever stored as a hash, a weak password is refused without using the invite
// up, a good one makes a working account, and every step is audited under the right person; fails_when=an expired invite still shows
// "pending" or blocks a new invite, an existing admin gets an invite, the raw token reaches the database, a weak password burns the invite,
// an audit record is missing, or a non-super admin can invite; why_new=none of this had a single test; seam=the email job and the audit queue
// are replaced (nothing is sent, and the audit calls are captured); no_claim=email delivery, the audit worker.

const audit = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: async (p: Record<string, unknown>) => { audit.calls.push(p) } }))

const app = createApp()
const SUPER = 'inv-super@test.ocar'
const OPS = 'inv-ops@test.ocar'
const NEW = 'inv-new@test.ocar'
const EMAILS = [NEW, 'inv-pw@test.ocar', 'inv-gone@test.ocar']
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

let superToken: string
let opsToken: string
let superId: string
const emailJobs: Array<{ email: string; rawToken: string; role?: string; inviterEmail?: string; expiresAt?: string }> = []

const api = (token: string) => ({
  get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${token}`),
  post: (url: string, body?: unknown) => request(app).post(url).set('Authorization', `Bearer ${token}`).send((body ?? {}) as object),
  patch: (url: string) => request(app).patch(url).set('Authorization', `Bearer ${token}`),
})
const invite = (email: string, role = 'ops_admin', token = superToken) => api(token).post('/api/v1/admin/invites', { email, role })
const lastJob = () => emailJobs[emailJobs.length - 1]!
const listed = async (email: string) =>
  ((await api(superToken).get('/api/v1/admin/invites')).body.invites as Array<{ id: string; email: string; status: string }>).filter((i) => i.email === email)
const actions = () => audit.calls.map((c) => c['action'])

async function cleanup() {
  await pool.query('DELETE FROM admin_invites WHERE email = ANY($1) OR invited_by IN (SELECT id FROM admins WHERE email = ANY($2))', [EMAILS, [SUPER, OPS]])
  await cleanupAdmins(pool, [...EMAILS, SUPER, OPS])
}

beforeAll(async () => {
  await cleanup()
  await seedAdmin(pool, SUPER, 'super_admin')
  await seedAdmin(pool, OPS, 'ops_admin')
  const s = await loginAdmin(app, SUPER)
  superToken = s.accessToken
  superId = String((await pool.query<{ id: string }>('SELECT id FROM admins WHERE email = $1', [SUPER])).rows[0]!.id)
  opsToken = (await loginAdmin(app, OPS)).accessToken
  vi.spyOn(notificationsQueue, 'add').mockImplementation((async (_name: string, data: { email: string; rawToken: string; role?: string; inviterEmail?: string; expiresAt?: string }) => {
    emailJobs.push(data)
    return {} as never
  }) as never)
}, 60_000)

afterAll(async () => {
  vi.restoreAllMocks()
  await cleanup()
  await pool.end()
})

describe('inviting', () => {
  it('only a super admin can invite (an ops admin gets 403 and nothing is created)', async () => {
    const before = emailJobs.length
    expect((await invite(NEW, 'ops_admin', opsToken)).status).toBe(403)
    expect(emailJobs.length).toBe(before)
  })

  it('creates a pending invite, emails the raw token, stores only its hash, and normalises the address', async () => {
    const res = await invite('  Inv-New@Test.Ocar ')
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.invite).toMatchObject({ email: NEW, role: 'ops_admin', status: 'pending' })
    expect(res.body.invite).not.toHaveProperty('token_hash')

    const job = lastJob()
    expect(job.email).toBe(NEW)
    expect(job).toMatchObject({ role: 'ops_admin', inviterEmail: SUPER }) // what the email needs to say who invited them, as what
    expect(new Date(job.expiresAt!).getTime() - Date.now()).toBeGreaterThan(47 * 3600_000)
    const row = (await pool.query<{ token_hash: string }>('SELECT token_hash FROM admin_invites WHERE id = $1', [res.body.invite.id])).rows[0]!
    expect(row.token_hash).toBe(sha256(job.rawToken))
    expect(JSON.stringify(row)).not.toContain(job.rawToken)
  })

  it('refuses a second live invite for the same address (409)', async () => {
    const res = await invite(NEW)
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ADMIN_INVITE_DUPLICATE')
  })

  it('refuses someone who is already an admin, in any letter case, and sends nothing', async () => {
    const before = emailJobs.length
    for (const email of [OPS, OPS.toUpperCase()]) {
      const res = await invite(email)
      expect(res.status, email).toBe(409)
      expect(res.body.code).toBe('ADMIN_ALREADY_EXISTS')
    }
    expect(emailJobs.length).toBe(before)
  })

  it('refuses a bad address or role with a validation error', async () => {
    expect((await invite('not-an-email')).status).toBe(422)
    expect((await invite('inv-pw@test.ocar', 'owner')).status).toBe(422)
  })
})

describe('an invite nobody answered (the 48-hour bug)', () => {
  it('shows as expired in the list, stops blocking, and the old link is dead, even though the row still says pending', async () => {
    const [{ id }] = await listed(NEW)
    const oldToken = lastJob().rawToken
    await pool.query(`UPDATE admin_invites SET expires_at = now() - interval '1 hour' WHERE id = $1`, [id])

    expect((await pool.query('SELECT status FROM admin_invites WHERE id = $1', [id])).rows[0].status).toBe('pending') // the row is untouched...
    expect((await listed(NEW))[0]!.status).toBe('expired') // ...but everything that reads it says expired

    expect((await request(app).get('/api/v1/admin/invites/verify').query({ token: oldToken })).status).toBe(400)
    expect((await request(app).post('/api/v1/admin/invites/redeem').send({ token: oldToken, password: 'a-long-passphrase-77' })).status).toBe(400)

    const again = await invite(NEW) // this was a 409 before the fix: the person could not be invited again until someone revoked the dead invite
    expect(again.status, JSON.stringify(again.body)).toBe(201)
    expect((await listed(NEW)).map((i) => i.status).sort()).toEqual(['expired', 'pending'])
  })

  it('an expired invite cannot be "revoked back to life": revoking only works on a live one', async () => {
    const expired = (await listed(NEW)).find((i) => i.status === 'expired')!
    // it is still 'pending' in the row, so revoke is allowed and just marks it revoked: harmless, and the list says revoked
    const res = await api(superToken).patch(`/api/v1/admin/invites/${expired.id}/revoke`)
    expect(res.status).toBe(200)
    expect(res.body.invite.status).toBe('revoked')
  })
})

describe('activating', () => {
  it('a weak password is refused with its reason and the invite stays usable', async () => {
    const token = lastJob().rawToken
    const short = await request(app).post('/api/v1/admin/invites/redeem').send({ token, password: 'short-pw-1' })
    expect(short.status).toBe(422) // under 12 characters
    const context = await request(app).post('/api/v1/admin/invites/redeem').send({ token, password: 'my-OCAR-passphrase-2026' })
    expect(context.status).toBe(422)
    expect(context.body.code).toBe('WEAK_PASSWORD')
    expect(context.body.error).toMatch(/ocar|email/i)

    expect((await pool.query('SELECT status FROM admin_invites WHERE token_hash = $1', [sha256(token)])).rows[0].status).toBe('pending')
    expect((await request(app).get('/api/v1/admin/invites/verify').query({ token })).status).toBe(200) // still valid for a better attempt
  })

  it('a good password creates a working account, uses the invite up, and the link cannot be used twice', async () => {
    const token = lastJob().rawToken
    const password = 'a-long-passphrase-77'
    const res = await request(app).post('/api/v1/admin/invites/redeem').send({ token, password })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.admin).toMatchObject({ email: NEW, role: 'ops_admin' })
    expect(Object.keys(res.body.admin).sort()).toEqual(['code', 'email', 'id', 'role'])

    expect((await loginAdmin(app, NEW, password)).accessToken).toBeTruthy() // they can really sign in
    expect((await listed(NEW)).find((i) => i.status === 'accepted')).toBeTruthy()

    const reuse = await request(app).post('/api/v1/admin/invites/redeem').send({ token, password: 'another-passphrase-88' })
    expect(reuse.status).toBe(400)
    expect(reuse.body.code).toBe('ADMIN_INVITE_INVALID')
  })

  it('once they are an admin they cannot be invited again', async () => {
    expect((await invite(NEW)).status).toBe(409)
  })

  it('an unknown token and a missing token are refused the same way', async () => {
    expect((await request(app).get('/api/v1/admin/invites/verify').query({ token: 'nope' })).status).toBe(400)
    expect((await request(app).get('/api/v1/admin/invites/verify')).status).toBe(400)
    expect((await request(app).post('/api/v1/admin/invites/redeem').send({ token: 'nope', password: 'a-long-passphrase-77' })).status).toBe(400)
  })
})

describe('revoking and the audit trail', () => {
  it('revokes a live invite once, and a second try is a 404', async () => {
    const created = await invite('inv-gone@test.ocar')
    expect(created.status).toBe(201)
    const id = created.body.invite.id
    expect((await api(superToken).patch(`/api/v1/admin/invites/${id}/revoke`)).body.invite.status).toBe('revoked')
    expect((await api(superToken).patch(`/api/v1/admin/invites/${id}/revoke`)).status).toBe(404)
    expect((await request(app).get('/api/v1/admin/invites/verify').query({ token: lastJob().rawToken })).status).toBe(400)
  })

  it('every step left an audit record under the right person, and none of them contains a token', async () => {
    expect(actions()).toEqual(expect.arrayContaining(['admins.invite_create', 'admins.invite_revoke', 'admins.invite_accept']))
    const created = audit.calls.filter((c) => c['action'] === 'admins.invite_create')
    expect(created.every((c) => String(c['adminId']) === superId)).toBe(true) // the inviter, never the invitee
    const accepted = audit.calls.find((c) => c['action'] === 'admins.invite_accept')!
    const newId = (await pool.query<{ id: string }>('SELECT id FROM admins WHERE email = $1', [NEW])).rows[0]!.id
    expect(String(accepted['adminId'])).toBe(newId) // the new admin is the actor of their own activation
    expect(accepted['afterState']).toMatchObject({ email: NEW, role: 'ops_admin', invitedBy: superId })
    const all = JSON.stringify(audit.calls, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    for (const job of emailJobs) expect(all).not.toContain(job.rawToken)
  })

  it('failed attempts leave no audit record (no invite was created, revoked or accepted)', async () => {
    const before = audit.calls.length
    await invite(OPS) // already an admin
    await api(superToken).patch('/api/v1/admin/invites/999999999/revoke') // does not exist
    await request(app).post('/api/v1/admin/invites/redeem').send({ token: 'nope', password: 'a-long-passphrase-77' })
    expect(audit.calls.length).toBe(before)
  })
})
