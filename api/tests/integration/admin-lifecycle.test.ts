import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool, withTransaction } from '@/db/client'
import { seedAdmin, loginAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'
import { assertAnotherSuperRemains, lockActiveSuperAdmins } from '@/modules/admin/admin-lifecycle.repository'

// Value: protects=a super admin can change another admin's role, remove them, reset their 2FA or sign them out, and it takes effect on their
// NEXT request (not minutes later): a signed-out or removed admin's token stops working at once, a changed role applies at once, a removed
// admin's address can be invited again; every one of these re-asks for the acting admin's own password (a wrong one is a 403, never a 401 that
// would log the person out), refuses acting on yourself, is limited to super admins, and is audited with no password hash or 2FA secret in it;
// fails_when=a token keeps working after sign-out or removal, the old role lingers, a wrong password signs the actor out or is accepted, a
// non-super admin can act, an audit record holds a secret, the last super admin can be removed, or a removed address can never be reused;
// why_new=the page could only suspend; seam=the audit queue is replaced (calls captured); no_claim=the throttle (skipped under test; unit
// tested) and a real two-request race (the lock is proven at database level below).

const audit = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: async (p: Record<string, unknown>) => { audit.calls.push(p) } }))

const app = createApp()
const PW = 'Admin@1234'
const A = 'lc-a@test.ocar' // the acting super admin
const B = 'lc-b@test.ocar' // a second super admin
const OPS = 'lc-ops@test.ocar'
const T = ['lc-t1@test.ocar', 'lc-t2@test.ocar', 'lc-t3@test.ocar', 'lc-t4@test.ocar', 'lc-t5@test.ocar', 'lc-t6@test.ocar']
const ALL = [A, B, OPS, ...T]

let tokenA: string
let tokenOps: string
let idOf: Record<string, string> = {}

const as = (token: string) => ({
  patch: (url: string, body?: object) => request(app).patch(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
  post: (url: string, body?: object) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
  delete: (url: string, body?: object) => request(app).delete(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
  get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${token}`),
})
const act = () => as(tokenA)
const role = (email: string, to: string, password = PW) => act().patch(`/api/v1/admin/admins/${idOf[email]}/role`, { role: to, password })
const row = async (email: string) => (await pool.query('SELECT role, is_active, deleted_at, totp_enabled, totp_secret_enc, sessions_valid_from, email FROM admins WHERE id = $1', [idOf[email]])).rows[0]
const loginFull = async (email: string, password = PW) => {
  const res = await request(app).post('/api/v1/auth/admin/login').send({ email, password })
  return { status: res.status, access: res.body?.tokens?.accessToken as string, refresh: res.body?.tokens?.refreshToken as string }
}
const lastAudit = (action: string) => [...audit.calls].reverse().find((c) => c['action'] === action)
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))

async function cleanup() {
  const emails = (await pool.query<{ email: string }>(`SELECT email FROM admins WHERE email LIKE 'lc-%@test.ocar' OR email LIKE 'lc-%+removed-%@test.ocar'`)).rows.map((r) => r.email)
  const ids = (await pool.query<{ id: string }>('SELECT id FROM admins WHERE email = ANY($1)', [emails])).rows.map((r) => r.id)
  if (ids.length) {
    await pool.query('DELETE FROM admin_recovery_codes WHERE admin_id = ANY($1::bigint[])', [ids])
    await pool.query(`DELETE FROM refresh_tokens WHERE principal_role = 'admin' AND principal_id = ANY($1::bigint[])`, [ids])
    await pool.query('DELETE FROM admin_invites WHERE invited_by = ANY($1::bigint[]) OR email LIKE $2', [ids, 'lc-%@test.ocar'])
  }
  await cleanupAdmins(pool, emails)
}

beforeAll(async () => {
  await cleanup()
  await seedAdmin(pool, A, 'super_admin')
  await seedAdmin(pool, B, 'super_admin')
  await seedAdmin(pool, OPS, 'ops_admin')
  for (const t of T) await seedAdmin(pool, t, 'ops_admin')
  idOf = Object.fromEntries((await pool.query<{ id: string; email: string }>('SELECT id, email FROM admins WHERE email = ANY($1)', [ALL])).rows.map((r) => [r.email, r.id]))
  tokenA = (await loginAdmin(app, A)).accessToken
  tokenOps = (await loginAdmin(app, OPS)).accessToken
}, 60_000)

afterAll(async () => {
  await cleanup()
  await pool.end()
})

describe('who may do it, and the password check', () => {
  const calls = (id: string) => [
    ['patch', `/api/v1/admin/admins/${id}/role`, { role: 'finance_admin', password: PW }],
    ['delete', `/api/v1/admin/admins/${id}`, { password: PW, confirmEmail: 'x@y.test' }],
    ['post', `/api/v1/admin/admins/${id}/reset-2fa`, { password: PW }],
    ['post', `/api/v1/admin/admins/${id}/sign-out`, { password: PW }],
  ] as const

  it('only a super admin: an ops admin gets 403 and a signed-out caller 401, on all four', async () => {
    for (const [verb, url, body] of calls(idOf[T[0]!]!)) {
      expect((await as(tokenOps)[verb](url, body)).status, `${verb} ${url} as ops`).toBe(403)
      expect((await request(app)[verb](url).send(body)).status, `${verb} ${url} signed out`).toBe(401)
    }
    expect((await row(T[0]!)).role).toBe('ops_admin') // nothing changed
  })

  it('a wrong password is a 403 with its own code (NOT a 401: that would sign the actor out for a typo), and changes nothing', async () => {
    const res = await role(T[0]!, 'finance_admin', 'wrong-password')
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('ADMIN_STEP_UP_INVALID')
    expect(res.body.error).toBe('That password is not right')
    expect((await row(T[0]!)).role).toBe('ops_admin')
    expect((await act().get('/api/v1/admin/admins')).status).toBe(200) // the actor's own session is untouched
  })

  it('a missing or empty password is refused before anything happens (422), and extra fields are refused', async () => {
    expect((await act().patch(`/api/v1/admin/admins/${idOf[T[0]!]}/role`, { role: 'finance_admin' })).status).toBe(422)
    expect((await act().patch(`/api/v1/admin/admins/${idOf[T[0]!]}/role`, { role: 'finance_admin', password: '' })).status).toBe(422)
    expect((await act().patch(`/api/v1/admin/admins/${idOf[T[0]!]}/role`, { role: 'owner', password: PW })).status).toBe(422)
    expect((await act().patch(`/api/v1/admin/admins/${idOf[T[0]!]}/role`, { role: 'finance_admin', password: PW, extra: 1 })).status).toBe(422)
  })

  it('nobody can act on themselves, and an unknown admin is a 404', async () => {
    for (const [verb, url, body] of calls(idOf[A]!)) {
      const res = await act()[verb](url, verb === 'delete' ? { ...body, confirmEmail: A } : body)
      expect(res.status, `${verb} ${url}`).toBe(422)
      expect(res.body.error).toMatch(/your own account/)
    }
    expect((await act().post('/api/v1/admin/admins/999999999/sign-out', { password: PW })).status).toBe(404)
    expect((await row(A)).is_active).toBe(true)
  })
})

describe('change role', () => {
  it('changes the role, returns the account, and applies on the target\'s very next request (an ops admin\'s existing token can use super-only pages straight away)', async () => {
    const t = await loginFull(T[1]!)
    expect((await as(t.access).get('/api/v1/admin/admins')).status).toBe(403) // ops: not allowed
    const res = await role(T[1]!, 'super_admin')
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.admin).toMatchObject({ email: T[1], role: 'super_admin' })
    expect((await as(t.access).get('/api/v1/admin/admins')).status).toBe(200) // same token, new role, no 20-second wait
    const back = await role(T[1]!, 'support_admin')
    expect(back.status).toBe(200)
    expect((await as(t.access).get('/api/v1/admin/admins')).status).toBe(403) // and demotion applies at once too
  })

  it('the same role again is refused (422), and the change is audited under the actor with no secrets', async () => {
    expect((await role(T[1]!, 'support_admin')).status).toBe(422)
    const a = lastAudit('admins.role_change')!
    expect(a).toMatchObject({ adminId: BigInt(idOf[A]!), targetTable: 'admins', targetId: BigInt(idOf[T[1]!]!) })
    expect(a['beforeState']).toEqual({ email: T[1], role: 'super_admin' })
    expect(a['afterState']).toEqual({ email: T[1], role: 'support_admin' })
  })
})

describe('sign out everywhere', () => {
  it('the target\'s access token stops working AT ONCE (not when it expires), their refresh token is dead, and they can sign in again', async () => {
    const t = await loginFull(T[2]!)
    await role(T[2]!, 'super_admin') // a super admin can call /admin/admins, so a 200 vs 401 shows the session state
    expect((await as(t.access).get('/api/v1/admin/admins')).status).toBe(200)

    const res = await act().post(`/api/v1/admin/admins/${idOf[T[2]!]}/sign-out`, { password: PW })
    expect(res.status, JSON.stringify(res.body)).toBe(204)
    expect((await as(t.access).get('/api/v1/admin/admins')).status).toBe(401) // the same token, a moment later
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: t.refresh })).status).toBe(401)
    expect((await row(T[2]!)).sessions_valid_from).not.toBeNull()

    await new Promise((r) => setTimeout(r, 1100)) // tokens are stamped in whole seconds: sign in after the cut-off second
    const again = await loginFull(T[2]!)
    expect(again.status).toBe(200)
    expect((await as(again.access).get('/api/v1/admin/admins')).status).toBe(200) // a new sign-in is fine
    expect(lastAudit('admins.sign_out')).toMatchObject({ adminId: BigInt(idOf[A]!), targetId: BigInt(idOf[T[2]!]!) })
  })
})

describe('reset 2FA', () => {
  it('an admin without 2FA has nothing to reset (409)', async () => {
    const res = await act().post(`/api/v1/admin/admins/${idOf[T[3]!]}/reset-2fa`, { password: PW })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ADMIN_NO_2FA')
  })

  it('switches 2FA off, deletes the secret and recovery codes, signs them out, and records it', async () => {
    await pool.query(`UPDATE admins SET totp_enabled = true, totp_secret_enc = 'enc-secret', totp_last_timestep = 5 WHERE id = $1`, [idOf[T[3]!]])
    await pool.query(`INSERT INTO admin_recovery_codes (admin_id, code_hash) VALUES ($1, 'h1'), ($1, 'h2')`, [idOf[T[3]!]])
    const t = await loginFull(T[3]!).catch(() => null) // 2FA is on in the row, so a password login now asks for a code
    void t

    const res = await act().post(`/api/v1/admin/admins/${idOf[T[3]!]}/reset-2fa`, { password: PW })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.admin).toMatchObject({ email: T[3], totp_enabled: false })
    const r = await row(T[3]!)
    expect(r).toMatchObject({ totp_enabled: false, totp_secret_enc: null })
    expect(r.sessions_valid_from).not.toBeNull()
    expect((await pool.query('SELECT count(*)::int AS n FROM admin_recovery_codes WHERE admin_id = $1', [idOf[T[3]!]])).rows[0].n).toBe(0)
    expect((await loginFull(T[3]!)).status).toBe(200) // they can sign in with the password again, and set 2FA up afresh
    expect(lastAudit('admins.reset_2fa')).toMatchObject({ adminId: BigInt(idOf[A]!), beforeState: { email: T[3], totp_enabled: true }, afterState: { totp_enabled: false, signed_out: true } })
  })
})

describe('remove', () => {
  it('needs the email typed exactly (422 otherwise), and a wrong password is a 403', async () => {
    const id = idOf[T[4]!]
    expect((await act().delete(`/api/v1/admin/admins/${id}`, { password: PW, confirmEmail: 'someone-else@test.ocar' })).status).toBe(422)
    expect((await act().delete(`/api/v1/admin/admins/${id}`, { password: 'nope', confirmEmail: T[4] })).status).toBe(403)
    expect((await row(T[4]!)).deleted_at).toBeNull()
  })

  it('removes the account: token dead at once, cannot sign in, gone from the list, and the address is free to be invited again', async () => {
    await role(T[4]!, 'super_admin')
    const t = await loginFull(T[4]!)
    expect((await as(t.access).get('/api/v1/admin/admins')).status).toBe(200)

    const res = await act().delete(`/api/v1/admin/admins/${idOf[T[4]!]}`, { password: PW, confirmEmail: `  ${T[4]!.toUpperCase()} ` }) // case and spaces do not matter
    expect(res.status, JSON.stringify(res.body)).toBe(204)

    expect((await as(t.access).get('/api/v1/admin/admins')).status).toBe(401) // the token they were using, a moment later
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: t.refresh })).status).toBe(401)
    expect((await loginFull(T[4]!)).status).toBe(401) // no longer a valid login
    const list = (await act().get('/api/v1/admin/admins')).body.admins as Array<{ email: string }>
    expect(list.some((a) => a.email.startsWith('lc-t5'))).toBe(false)

    const r = (await pool.query<{ email: string; deleted_at: Date | null; is_active: boolean }>('SELECT email, deleted_at, is_active FROM admins WHERE id = $1', [idOf[T[4]!]])).rows[0]!
    expect(r.deleted_at).not.toBeNull()
    expect(r.is_active).toBe(false)
    expect(r.email).toBe(`lc-t5+removed-${idOf[T[4]!]}@test.ocar`) // still readable in the audit trail, original address freed

    const reinvite = await act().post('/api/v1/admin/invites', { email: T[4], role: 'ops_admin' })
    expect(reinvite.status, JSON.stringify(reinvite.body)).toBe(201) // the same person can be invited again
    expect(lastAudit('admins.remove')).toMatchObject({ adminId: BigInt(idOf[A]!), beforeState: { email: T[4], role: 'super_admin' }, afterState: { removed: true } })
  })

  it('a removed admin that is already gone is a 404', async () => {
    expect((await act().delete(`/api/v1/admin/admins/${idOf[T[4]!]}`, { password: PW, confirmEmail: T[4] })).status).toBe(404)
  })
})

describe('the audit log never holds a secret', () => {
  it('suspending and reactivating still work, are audited, and the record has no password hash or 2FA secret (it used to store the whole row)', async () => {
    await pool.query(`UPDATE admins SET totp_secret_enc = 'enc-secret-must-not-leak' WHERE id = $1`, [idOf[T[5]!]])
    const res = await act().patch(`/api/v1/admin/admins/${idOf[T[5]!]}/status`, { status: 'suspended' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.admin).toMatchObject({ email: T[5], admin_status: 'suspended' })
    const a = lastAudit('admins.status_change')!
    const text = json(a)
    expect(text).not.toMatch(/password_hash|totp_secret|enc-secret-must-not-leak|\$2[aby]\$/)
    expect(Object.keys(a['beforeState'] as object).sort()).toEqual(['admin_status', 'code', 'created_at', 'email', 'id', 'last_login_at', 'role', 'totp_enabled'])
    expect((await act().patch(`/api/v1/admin/admins/${idOf[T[5]!]}/status`, { status: 'active' })).status).toBe(200)
  })

  it('the list shows 2FA state and last sign-in, and still no secret', async () => {
    const list = (await act().get('/api/v1/admin/admins')).body.admins as Array<Record<string, unknown>>
    expect(list.length).toBeGreaterThan(0)
    for (const a of list) {
      expect(a).toHaveProperty('totp_enabled')
      expect(a).toHaveProperty('last_login_at')
      expect(json(a)).not.toMatch(/password|secret/i)
    }
  })

  it('none of the actions above put a secret in an audit record', () => {
    expect(json(audit.calls)).not.toMatch(/password_hash|totp_secret|enc-secret|\$2[aby]\$/)
  })
})

describe('never zero super admins (real SQL, rolled back)', () => {
  it('the guard sees exactly the active super admins, and refuses when the target is the last one', async () => {
    const aId = idOf[A]!
    const bId = idOf[B]!
    await withTransaction(async (client) => {
      // Inside this transaction only (rolled back below): every super admin except A and B is switched off.
      await client.query(`UPDATE admins SET is_active = false WHERE role = 'super_admin' AND id NOT IN ($1, $2)`, [aId, bId])
      const both = await lockActiveSuperAdmins(client)
      expect(new Set(both)).toEqual(new Set([aId, bId]))
      expect(() => assertAnotherSuperRemains(both, aId)).not.toThrow() // B would remain
      await client.query('UPDATE admins SET is_active = false WHERE id = $1', [bId])
      const onlyA = await lockActiveSuperAdmins(client)
      expect(onlyA).toEqual([aId])
      expect(() => assertAnotherSuperRemains(onlyA, aId)).toThrowError(/at least one active super admin/)
      throw new Error('rollback') // never commit these changes
    }).catch((e: Error) => { if (e.message !== 'rollback') throw e })
    expect((await row(B)).is_active).toBe(true) // really rolled back
  })

  it('two requests cannot both pass the check: the second waits for the first (the locks are real)', async () => {
    const first = await pool.connect()
    const second = await pool.connect()
    try {
      await first.query('BEGIN')
      await lockActiveSuperAdmins(first)
      await second.query('BEGIN')
      await second.query(`SET LOCAL lock_timeout = '300ms'`)
      await expect(lockActiveSuperAdmins(second)).rejects.toThrow(/lock timeout/i) // it had to wait: it did not read stale data
      await second.query('ROLLBACK')
      await first.query('ROLLBACK')
      await second.query('BEGIN')
      await second.query(`SET LOCAL lock_timeout = '300ms'`)
      await expect(lockActiveSuperAdmins(second)).resolves.toBeDefined() // free again once the first finished
    } finally {
      await second.query('ROLLBACK').catch(() => undefined)
      await first.query('ROLLBACK').catch(() => undefined)
      first.release()
      second.release()
    }
  })
})
