import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { recordAuditLog } from '@/lib/audit-log'
import { verifyChain } from '@/modules/admin-audit/admin-audit.repository'
import { seedAdmin, loginAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'

// The admin audit trail end to end against the real app and database: the catch-all middleware, the explicit
// recorder, the hash chain and its tamper detection, and the query API. Nothing here is mocked.

const app = createApp()
const SUPER = 'audit-trail-super@ocar.app'
const OPS = 'audit-trail-ops@ocar.app'
let superToken: string
let opsToken: string
let userId: string

async function wipeAuditLog(): Promise<void> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query("SET LOCAL ocar.allow_audit_truncate = 'on'")
    await c.query('TRUNCATE admin_audit_log')
    await c.query('COMMIT')
  } finally { c.release() }
}

// The middleware writes after the response is sent, so poll briefly instead of racing it.
async function waitForRow(sql: string, params: unknown[] = []): Promise<Record<string, unknown>> {
  for (let i = 0; i < 40; i++) {
    const r = await pool.query(sql, params)
    if (r.rows[0]) return r.rows[0] as Record<string, unknown>
    await new Promise(res => setTimeout(res, 50))
  }
  throw new Error(`no row for: ${sql}`)
}

beforeAll(async () => {
  await seedAdmin(pool, SUPER, 'super_admin')
  await seedAdmin(pool, OPS, 'ops_admin')
  superToken = (await loginAdmin(app, SUPER)).accessToken
  opsToken = (await loginAdmin(app, OPS)).accessToken
  const u = await pool.query<{ id: string }>(
    `INSERT INTO users (phone, name) VALUES ('+910000009911', 'Audit Probe') ON CONFLICT (phone) DO UPDATE SET name = 'Audit Probe' RETURNING id`)
  userId = u.rows[0]!.id
  await wipeAuditLog()
})

afterAll(async () => {
  await cleanupAdmins(pool, [SUPER, OPS])
  await pool.query('DELETE FROM users WHERE id = $1', [userId])
  await redis.quit().catch(() => undefined)
})

describe('admin audit trail', () => {
  it('records a write that has no hand-written audit call, with request context', async () => {
    const res = await request(app).patch(`/api/v1/admin/users/${userId}/status`)
      .set('Authorization', `Bearer ${superToken}`).set('User-Agent', 'audit-test/1.0')
      .send({ status: 'suspended' })
    expect(res.status).toBe(200)
    const row = await waitForRow(`SELECT * FROM admin_audit_log WHERE action = 'users.status' AND target_id = $1`, [userId])
    expect(row['outcome']).toBe('success')
    expect(row['source']).toBe('http')
    expect(row['actor_email']).toBe(SUPER)
    expect(row['actor_role']).toBe('super_admin')
    expect(row['http_status']).toBe(200)
    expect(row['user_agent']).toBe('audit-test/1.0')
    expect(String(row['request_id'])).toMatch(/^[0-9a-f-]{36}$/)
    expect(row['chain_seq']).not.toBeNull()
    expect((row['after_state'] as { request: { status: string } }).request.status).toBe('suspended')
  })

  it('records a refused attempt as denied', async () => {
    const res = await request(app).patch('/api/v1/admin/admins/1/status')
      .set('Authorization', `Bearer ${opsToken}`).send({ status: 'inactive' })
    expect(res.status).toBe(403)
    const row = await waitForRow(`SELECT * FROM admin_audit_log WHERE outcome = 'denied' AND actor_email = $1`, [OPS])
    expect(row['action']).toBe('admins.status')
    expect(row['http_status']).toBe(403)
  })

  it('does not add a generic row when the handler audited itself', async () => {
    const res = await request(app).patch('/api/v1/admin/maintenance').set('Authorization', `Bearer ${superToken}`).send({ enabled: false })
    expect(res.status).toBe(200)
    await waitForRow(`SELECT 1 FROM admin_audit_log WHERE action = 'maintenance_mode.update'`)
    await new Promise(r => setTimeout(r, 300)) // give a (wrongly) duplicated row time to appear
    const rows = await pool.query(`SELECT source FROM admin_audit_log WHERE action LIKE 'maintenance%'`)
    expect(rows.rows).toEqual([{ source: 'service' }])
  })

  it('records admin sign-ins, including a refused password', async () => {
    const bad = await request(app).post('/api/v1/auth/admin/login').send({ email: OPS, password: 'wrong-password-1' })
    expect(bad.status).toBeGreaterThanOrEqual(400)
    const failed = await waitForRow(`SELECT * FROM admin_audit_log WHERE action = 'auth.admin.login' AND outcome = 'failure'`)
    expect(failed['source']).toBe('auth')
    expect(failed['actor_email']).toBe(OPS)
    expect(JSON.stringify(failed['after_state'])).not.toContain('wrong-password-1')
    await loginAdmin(app, OPS)
    const ok = await waitForRow(`SELECT * FROM admin_audit_log WHERE action = 'auth.admin.login' AND outcome = 'success'`)
    expect(ok['actor_email']).toBe(OPS)
  })

  it('redacts secrets and masks phone numbers before they are stored', async () => {
    await recordAuditLog({
      adminId: null, action: 'test.redact', targetTable: 'users', targetId: 1n,
      afterState: { password: 'hunter2', phone: '+919876543210', note: 'ok', doc_url: 'https://b.s3.amazonaws.com/x.jpg?X-Amz-Signature=abc' },
    })
    const row = await waitForRow(`SELECT after_state FROM admin_audit_log WHERE action = 'test.redact'`)
    const s = row['after_state'] as Record<string, string>
    expect(s['password']).toBe('[redacted]')
    expect(s['phone']).toBe('********3210')
    expect(s['doc_url']).toBe('https://b.s3.amazonaws.com/x.jpg')
    expect(s['note']).toBe('ok')
  })

  it('writes the audit row in the caller\'s transaction and rolls it back with it', async () => {
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await recordAuditLog({ adminId: null, action: 'test.rolled_back', targetTable: 'users', targetId: 1n, client: c })
      await c.query('ROLLBACK')
    } finally { c.release() }
    const r = await pool.query(`SELECT 1 FROM admin_audit_log WHERE action = 'test.rolled_back'`)
    expect(r.rowCount).toBe(0)
  })

  it('keeps an unbroken hash chain, then detects tampering', async () => {
    const ok = await verifyChain()
    expect(ok.ok).toBe(true)
    expect(ok.checked).toBeGreaterThanOrEqual(3)

    // Anyone with superuser access can switch the append-only triggers off. That must be caught by the chain.
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query("SET LOCAL session_replication_role = 'replica'")
      await c.query(`UPDATE admin_audit_log SET reason = 'edited later' WHERE action = 'test.redact'`)
      await c.query('COMMIT')
    } finally { c.release() }
    const bad = await verifyChain()
    expect(bad.ok).toBe(false)
    expect(bad.broken_at?.problem).toMatch(/does not match its hash/)

    const c2 = await pool.connect()
    try {
      await c2.query('BEGIN')
      await c2.query("SET LOCAL session_replication_role = 'replica'")
      await c2.query(`UPDATE admin_audit_log SET reason = NULL WHERE action = 'test.redact'`)
      await c2.query('COMMIT')
    } finally { c2.release() }
    expect((await verifyChain()).ok).toBe(true)

    // A deleted row in the middle shows up as a gap.
    const c3 = await pool.connect()
    try {
      await c3.query('BEGIN')
      await c3.query("SET LOCAL session_replication_role = 'replica'")
      await c3.query(`DELETE FROM admin_audit_log WHERE action = 'users.status'`)
      await c3.query('COMMIT')
    } finally { c3.release() }
    const gap = await verifyChain()
    expect(gap.ok).toBe(false)
    expect(gap.broken_at?.problem).toMatch(/missing/)
  })

  it('refuses UPDATE, DELETE and TRUNCATE through normal SQL', async () => {
    await expect(pool.query(`UPDATE admin_audit_log SET reason = 'x'`)).rejects.toThrow(/append-only/)
    await expect(pool.query(`DELETE FROM admin_audit_log`)).rejects.toThrow(/append-only/)
    await expect(pool.query(`TRUNCATE admin_audit_log`)).rejects.toThrow(/append-only/)
  })
})

describe('audit log API', () => {
  beforeAll(async () => {
    await wipeAuditLog()
    for (let i = 1; i <= 7; i++) {
      await recordAuditLog({ adminId: null, action: i % 2 ? 'drivers.status_change' : 'pricing.rate-cards.create', targetTable: i % 2 ? 'drivers' : 'pricing', targetId: BigInt(i), reason: i === 3 ? 'fraud ring' : null })
    }
    await recordAuditLog({ adminId: null, action: 'cities.boundary.save', targetTable: 'cities', targetId: 9n, outcome: 'failure' })
  })

  const get = (path: string, token = superToken) => request(app).get(`/api/v1/admin/audit-log${path}`).set('Authorization', `Bearer ${token}`)

  it('is super_admin only', async () => {
    expect((await get('', opsToken)).status).toBe(403)
  })

  it('pages with a cursor, newest first, without skipping or repeating', async () => {
    const p1 = await get('?limit=3')
    expect(p1.body.entries).toHaveLength(3)
    expect(p1.body.next_cursor).toBe(p1.body.entries[2].id)
    const p2 = await get(`?limit=3&before=${p1.body.next_cursor}`)
    const p3 = await get(`?limit=3&before=${p2.body.next_cursor}`)
    const ids = [...p1.body.entries, ...p2.body.entries, ...p3.body.entries].map((e: { id: string }) => Number(e.id))
    expect(ids).toHaveLength(8)
    expect(new Set(ids).size).toBe(8)
    expect([...ids].sort((a, b) => b - a)).toEqual(ids)
    expect(p3.body.next_cursor).toBeNull()
  })

  it('filters by action (exact and prefix), outcome, target and text', async () => {
    expect((await get('?action=cities.boundary.save')).body.entries).toHaveLength(1)
    expect((await get('?action=drivers.*')).body.entries).toHaveLength(4)
    expect((await get('?action=drivers.status_change,pricing.rate-cards.create')).body.entries).toHaveLength(7)
    expect((await get('?outcome=failure')).body.entries).toHaveLength(1)
    expect((await get('?target_table=pricing&target_id=2')).body.entries).toHaveLength(1)
    expect((await get('?q=fraud')).body.entries).toHaveLength(1)
    expect((await get('?q=9')).body.entries.length).toBeGreaterThanOrEqual(1)
    expect((await get('?from=2999-01-01T00:00:00Z')).body.entries).toHaveLength(0)
  })

  it('treats LIKE wildcards in search as plain text', async () => {
    expect((await get('?q=%25')).body.entries).toHaveLength(0)
  })

  it('rejects malformed filters', async () => {
    expect((await get('?outcome=bogus')).status).toBe(400)
    expect((await get('?from=notadate')).status).toBe(400)
    expect((await get('?admin_id=1;drop')).status).toBe(400)
  })

  it('serves facets and a verified chain', async () => {
    const f = await get('/facets')
    expect(f.status).toBe(200)
    expect(f.body.actions.map((a: { action: string }) => a.action)).toContain('drivers.status_change')
    expect(f.body.stats.total_24h).toBeGreaterThanOrEqual(8)
    const v = await get('/verify')
    expect(v.body.ok).toBe(true)
  })

  it('exports CSV and audits the export itself', async () => {
    const res = await get('/export.csv?action=drivers.*')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.text.split('\r\n')[0]).toContain('Action')
    const logged = await waitForRow(`SELECT after_state FROM admin_audit_log WHERE action = 'audit_log.export'`)
    expect((logged['after_state'] as { rows: number }).rows).toBe(4)
  })
})
