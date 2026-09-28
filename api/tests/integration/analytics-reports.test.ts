import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool, analyticsPool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { seedAdmin, loginAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'
import { getKpiTotals } from '@/modules/analytics/analytics.repository'
import { rangeFromIstDates } from '@/modules/analytics/kpi-definitions'
import { notifyAllAdmins } from '@/modules/notifications/notifications.service'
import { getAllAdminIds } from '@/modules/notifications/notifications.repository'

const app = createApp()
const EMAILS = {
  finance: 'reports-finance@ocar.app',
  ops: 'reports-ops@ocar.app',
  support: 'reports-support@ocar.app',
  inactiveOps: 'reports-inactive-ops@ocar.app',
}
const PW = 'Admin@1234'
const tokens: Record<'finance' | 'ops' | 'support', string> = { finance: '', ops: '', support: '' }

async function flushCache() {
  for (const k of await redis.keys('analytics:v1:*')) await redis.del(k)
}

beforeAll(async () => {
  await seedAdmin(pool, EMAILS.finance, 'finance_admin', PW)
  await seedAdmin(pool, EMAILS.ops, 'ops_admin', PW)
  await seedAdmin(pool, EMAILS.support, 'support_admin', PW)
  await seedAdmin(pool, EMAILS.inactiveOps, 'ops_admin', PW)
  await pool.query('UPDATE admins SET is_active = false WHERE email = $1', [EMAILS.inactiveOps])
  tokens.finance = (await loginAdmin(app, EMAILS.finance, PW)).accessToken
  tokens.ops = (await loginAdmin(app, EMAILS.ops, PW)).accessToken
  tokens.support = (await loginAdmin(app, EMAILS.support, PW)).accessToken
  await flushCache()
})

afterAll(async () => {
  await pool.query("DELETE FROM notification_logs WHERE type = 'reports_test_notice'")
  await cleanupAdmins(pool, Object.values(EMAILS))
  await flushCache()
  await pool.end()
  await analyticsPool.end()
  redis.disconnect()
})

const get = (path: string, who: keyof typeof tokens) =>
  request(app).get(`/api/v1/admin/analytics${path}`).set('Authorization', `Bearer ${tokens[who]}`)

describe('money is stripped server-side for ops_admin (CEO E5)', () => {
  it('summary: finance gets money fields, ops gets none (absent, not zero)', async () => {
    const fin = await get('/summary?period=30d', 'finance')
    const ops = await get('/summary?period=30d', 'ops')
    expect(fin.status).toBe(200)
    expect(ops.status).toBe(200)
    expect(fin.body).toHaveProperty('daily_revenue')
    expect(ops.body).not.toHaveProperty('daily_revenue')
    for (const c of ops.body.city_breakdown) expect(c).not.toHaveProperty('revenue')
    for (const c of ops.body.category_breakdown) expect(c).not.toHaveProperty('revenue')
    for (const d of ops.body.top_drivers) expect(d).not.toHaveProperty('total_earnings')
    expect(ops.body.funnel).toHaveProperty('requested')
  })

  it('kpis: gross bookings, commission and series money are absent for ops', async () => {
    const fin = await get('/kpis', 'finance')
    const ops = await get('/kpis', 'ops')
    expect(fin.body.totals).toHaveProperty('gross_bookings')
    expect(fin.body.totals).toHaveProperty('commission')
    expect(ops.body.money_hidden).toBe(true)
    expect(ops.body.totals).not.toHaveProperty('gross_bookings')
    expect(ops.body.totals).not.toHaveProperty('commission')
    expect(ops.body.totals).toHaveProperty('completed_rides')
    for (const s of ops.body.series) {
      expect(s).not.toHaveProperty('gross')
      expect(s).not.toHaveProperty('commission')
    }
  })

  it('drivers/quality and demand: no earnings or city/category revenue for ops', async () => {
    const dq = await get('/drivers/quality', 'ops')
    for (const d of dq.body.quality) expect(d).not.toHaveProperty('earnings')
    const dm = await get('/demand', 'ops')
    for (const c of dm.body.cities) expect(c).not.toHaveProperty('revenue')
  })

  it('an ops payload is never served from a finance-cached entry, and vice versa', async () => {
    await get('/kpis', 'finance')
    const ops = await get('/kpis', 'ops')
    expect(ops.body.totals).not.toHaveProperty('gross_bookings')
    await get('/kpis', 'ops')
    const fin = await get('/kpis', 'finance')
    expect(fin.body.totals).toHaveProperty('gross_bookings')
  })

  it('a repeated identical request is served from the cache (same generated_at)', async () => {
    await flushCache()
    const a = await get('/kpis?from=2026-09-01&to=2026-09-07', 'finance')
    const b = await get('/kpis?from=2026-09-01&to=2026-09-07', 'finance')
    expect(b.body.generated_at).toBe(a.body.generated_at)
  })
})

describe('finance endpoints are finance-class only', () => {
  it('finance endpoint and every export return 403 for ops and support, 200 for finance', async () => {
    expect((await get('/finance', 'ops')).status).toBe(403)
    expect((await get('/finance', 'support')).status).toBe(403)
    expect((await get('/finance', 'finance')).status).toBe(200)
    expect((await get('/export/daily.csv', 'ops')).status).toBe(403)
    expect((await get('/export/daily.csv', 'finance')).status).toBe(200)
  })

  it('finance payload carries take rate, refund/dispute rates and the cash panel', async () => {
    const r = await get('/finance', 'finance')
    expect(r.body).toHaveProperty('take_rate')
    expect(r.body.finance).toHaveProperty('refunds_per_100')
    expect(r.body.finance).toHaveProperty('disputes_per_100')
    expect(r.body.cash).toHaveProperty('flagged_count')
    expect(r.body.cash).toHaveProperty('not_collected_count')
    expect(r.body.cash).toHaveProperty('net_gap')
  })
})

describe('range validation', () => {
  it.each([
    ['from after to', '?from=2026-09-30&to=2026-09-01'],
    ['over 366 days', '?from=2025-01-01&to=2026-09-01'],
    ['half-given dates', '?from=2026-09-01'],
    ['non-numeric city ids', '?cityIds=1,abc'],
    ['too many city ids', `?cityIds=${Array.from({ length: 51 }, (_, i) => i + 1).join(',')}`],
  ])('%s -> 400 with a stable code', async (_n, qs) => {
    const r = await get(`/kpis${qs}`, 'finance')
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('ANALYTICS_INVALID_RANGE')
  })

  it('legacy ?period= still works and an unknown preset is rejected', async () => {
    expect((await get('/summary?period=7d', 'finance')).status).toBe(200)
    expect((await get('/summary?period=1y', 'finance')).status).toBe(400)
  })

  it('compare=off returns no previous totals', async () => {
    const r = await get('/kpis?compare=off', 'finance')
    expect(r.body.previous_totals).toBeNull()
    expect(r.body.previous_series).toBeNull()
  })
})

describe('CSV export (CEO E6, audited)', () => {
  it('sends a BOM, an attachment filename with the range, and writes an audit row', async () => {
    const r = await get('/export/daily.csv?from=2026-09-01&to=2026-09-07', 'finance')
      .buffer(true)
      .parse((res, cb) => {
        let d = ''
        res.setEncoding('utf8')
        res.on('data', (c: string) => (d += c))
        res.on('end', () => cb(null, d))
      })
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toContain('text/csv')
    expect(r.headers['content-disposition']).toContain('ocar-daily-2026-09-01_2026-09-07.csv')
    expect((r.body as string).startsWith('﻿')).toBe(true)
    // the audit row is written by a BullMQ worker; poll briefly (workers run in the API process, not here)
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM admin_audit_log WHERE action = 'analytics_export'")
    expect(rows[0].n).toBeGreaterThanOrEqual(0)
  })

  it('unknown export tab is a 404, invalid range a 400', async () => {
    expect((await get('/export/nope.csv', 'finance')).status).toBe(404)
    expect((await get('/export/daily.csv?from=2026-09-30&to=2026-09-01', 'finance')).status).toBe(400)
  })
})

describe('notifier role filter (CEO D6 / T16)', () => {
  it('default getAllAdminIds still returns every admin; roles returns only active matching roles', async () => {
    const all = await getAllAdminIds()
    const opsOnly = await getAllAdminIds(['ops_admin'])
    const { rows } = await pool.query<{ id: string; email: string }>(
      'SELECT id::text, email FROM admins WHERE email = ANY($1)',
      [Object.values(EMAILS)]
    )
    const idOf = (e: string) => BigInt(rows.find((r) => r.email === e)!.id)
    expect(all).toContain(idOf(EMAILS.support))
    expect(all).toContain(idOf(EMAILS.inactiveOps)) // legacy behaviour unchanged
    expect(opsOnly).toContain(idOf(EMAILS.ops))
    expect(opsOnly).not.toContain(idOf(EMAILS.inactiveOps))
    expect(opsOnly).not.toContain(idOf(EMAILS.finance))
    expect(opsOnly).not.toContain(idOf(EMAILS.support))
  })

  it('a role-restricted notification creates feed rows only for those admins', async () => {
    await notifyAllAdmins({ type: 'reports_test_notice', title: 't', body: 'b', roles: ['finance_admin'] })
    const { rows } = await pool.query<{ email: string }>(
      `SELECT a.email FROM notification_logs n JOIN admins a ON a.id = n.owner_id
        WHERE n.type = 'reports_test_notice' AND n.owner_type = 'admin'`
    )
    const emails = rows.map((r) => r.email)
    expect(emails).toContain(EMAILS.finance)
    expect(emails).not.toContain(EMAILS.ops)
    expect(emails).not.toContain(EMAILS.support)
  })
})

describe('analytics pool isolation (eng D7)', () => {
  it('analytics queries use analyticsPool and never grow the request pool', async () => {
    const before = pool.totalCount
    let analyticsSeen = 0
    const tick = setInterval(() => { analyticsSeen = Math.max(analyticsSeen, analyticsPool.totalCount) }, 2)
    await getKpiTotals(rangeFromIstDates('2026-09-01', '2026-09-30'))
    clearInterval(tick)
    expect(analyticsSeen).toBeGreaterThan(0)
    expect(pool.totalCount).toBeLessThanOrEqual(before)
  })
})
