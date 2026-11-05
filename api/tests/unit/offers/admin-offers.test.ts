import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('@/config', () => ({ config: { NODE_ENV: 'test' } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
const role = vi.hoisted(() => ({ current: 'ops_admin' }))
vi.mock('@/middleware/auth.middleware', () => ({
  authenticate: () => (req: { admin?: { id: bigint; role: string } }, _r: unknown, n: () => void) => { req.admin = { id: 3n, role: role.current }; n() },
}))
const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(async () => client) } }))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))
const cfg = vi.hoisted(() => ({ values: {} as Record<string, string> }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn(async (k: string, fb: string) => cfg.values[k] ?? fb) }))
const repo = vi.hoisted(() => ({
  createOfferTx: vi.fn(), createVersionTx: vi.fn(), lockOfferForUpdate: vi.fn(), patchOfferTx: vi.fn(), getOfferAdmin: vi.fn(),
  listOffersAdmin: vi.fn(), offerStatusCounts: vi.fn(), offerStats: vi.fn(), listRedemptions: vi.fn(), invalidateOffers: vi.fn(), normalizeCode: (c: string) => c.trim().toUpperCase(),
}))
vi.mock('@/modules/offers/offers.repository', () => repo)

import adminOffersRouter from '@/modules/offers/admin-offers.routes'
import { errorMiddleware } from '@/middleware/error.middleware'
import { recordAuditLog } from '@/lib/audit-log'

const app = express()
app.use(express.json())
app.use('/admin/offers', adminOffersRouter)
app.use(errorMiddleware)

const row = { id: '5', code: 'SAVE10', name: 'n', kind: 'code', status: 'draft', version: 1, summary_rules: [], summary_benefit: { type: 'percent_off', percent: 10 }, display: {}, budget_total: null, budget_spent: '0', global_limit: null, redemption_count: 0, starts_at: null, ends_at: null, created_at: new Date(), updated_at: new Date() }
const version = { id: '9', version: 1, rules: [], benefit: { type: 'percent_off', percent: 10 }, per_user_limit: null, stacking: 'exclusive', display: {}, created_at: new Date() }
const body = { name: 'Ten off', kind: 'code', code: 'save10', benefit: { type: 'percent_off', percent: 10 } }

beforeEach(() => {
  vi.clearAllMocks()
  role.current = 'ops_admin'
  cfg.values = {}
  repo.createOfferTx.mockResolvedValue({ offerId: 5n, versionId: 9n })
  repo.getOfferAdmin.mockResolvedValue({ offer: row, versions: [version] })
  repo.lockOfferForUpdate.mockResolvedValue({ status: 'draft', budget_total: null, budget_spent: '0', starts_at: null, code: 'SAVE10' })
  repo.createVersionTx.mockResolvedValue({ versionId: 10n, version: 2 })
  repo.offerStats.mockResolvedValue([{ status: 'consumed', n: 2, discount: 80, cashback: 0 }])
  repo.listOffersAdmin.mockResolvedValue([row])
  repo.offerStatusCounts.mockResolvedValue({ active: 2, draft: 1 })
  repo.listRedemptions.mockResolvedValue([])
  client.query.mockResolvedValue({ rows: [], rowCount: 0 })
})

describe('roles', () => {
  it('finance_admin can read stats but cannot create', async () => {
    role.current = 'finance_admin'
    expect((await request(app).get('/admin/offers/5/stats')).status).toBe(200)
    expect((await request(app).post('/admin/offers').send(body)).status).toBe(403)
    expect(repo.createOfferTx).not.toHaveBeenCalled()
  })
  it('support_admin cannot read at all', async () => {
    role.current = 'support_admin'
    expect((await request(app).get('/admin/offers/5/stats')).status).toBe(403)
  })
})

describe('create and validation', () => {
  it('rejects invalid rule JSON with 422 naming the path', async () => {
    const res = await request(app).post('/admin/offers').send({ ...body, rules: [{ kind: 'min_fare', amount: -5 }] })
    expect(res.status).toBe(422)
    expect(JSON.stringify(res.body)).toMatch(/rules\.0/)
  })
  it('rejects an unknown rule kind with 422', async () => {
    const res = await request(app).post('/admin/offers').send({ ...body, rules: [{ kind: 'moon_phase' }] })
    expect(res.status).toBe(422)
  })
  it('normalises the code, creates the offer and records an offer.create audit entry', async () => {
    const res = await request(app).post('/admin/offers').send(body)
    expect(res.status).toBe(201)
    expect(repo.createOfferTx).toHaveBeenCalledWith(client, 3n, expect.objectContaining({ code: 'SAVE10', status: 'draft' }))
    expect(recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'offer.create', targetTable: 'offers' }))
    expect(repo.invalidateOffers).toHaveBeenCalledWith('SAVE10')
  })
  it('a duplicate code is a 409 CODE_TAKEN', async () => {
    repo.createOfferTx.mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }))
    const res = await request(app).post('/admin/offers').send(body)
    expect(res.status).toBe(409)
  })
  it('a code offer needs a code and an automatic offer cannot have one', async () => {
    expect((await request(app).post('/admin/offers').send({ ...body, code: undefined })).status).toBe(422)
    expect((await request(app).post('/admin/offers').send({ ...body, kind: 'auto' })).status).toBe(422)
  })
  it('refuses a cashback benefit while offers_cashback_enabled is false (CASHBACK_DISABLED), accepts it once true', async () => {
    const cashback = { ...body, benefit: { type: 'cashback_percent', percent: 10, expiresInDays: 30 } }
    const refused = await request(app).post('/admin/offers').send(cashback)
    expect(refused.status).toBe(422)
    expect(JSON.stringify(refused.body)).toMatch(/CASHBACK_DISABLED/)
    cfg.values['offers_cashback_enabled'] = 'true'
    expect((await request(app).post('/admin/offers').send(cashback)).status).toBe(201)
  })
  it('refuses a percent discount above offers_max_discount_percent (DISCOUNT_TOO_HIGH)', async () => {
    const res = await request(app).post('/admin/offers').send({ ...body, benefit: { type: 'percent_off', percent: 16 } })
    expect(res.status).toBe(422)
    expect(JSON.stringify(res.body)).toMatch(/DISCOUNT_TOO_HIGH/)
    cfg.values['offers_max_discount_percent'] = '20'
    expect((await request(app).post('/admin/offers').send({ ...body, benefit: { type: 'percent_off', percent: 16 } })).status).toBe(201)
  })
})

describe('review hardening', () => {
  const flat = (amount: number, rules: object[] = []) => ({ ...body, benefit: { type: 'flat_off', amount }, rules })
  it('a flat discount needs a minimum fare that keeps it within the cap, and says what is needed', async () => {
    const none = await request(app).post('/admin/offers').send(flat(50))
    expect(none.status).toBe(422)
    expect(JSON.stringify(none.body)).toMatch(/DISCOUNT_TOO_HIGH/)
    expect(JSON.stringify(none.body)).toMatch(/334/) // 50 / 15% = 333.4 -> 334
    expect((await request(app).post('/admin/offers').send(flat(50, [{ kind: 'min_fare', amount: 300 }]))).status).toBe(422)
    expect((await request(app).post('/admin/offers').send(flat(50, [{ kind: 'min_fare', amount: 334 }]))).status).toBe(201)
  })
  it('a first-ride offer defaults its per-user limit (new_user 1, first_n_rides n) so concurrent bookings cannot all claim it', async () => {
    await request(app).post('/admin/offers').send({ ...body, rules: [{ kind: 'new_user' }] })
    expect(repo.createOfferTx).toHaveBeenLastCalledWith(client, 3n, expect.objectContaining({ perUserLimit: 1 }))
    await request(app).post('/admin/offers').send({ ...body, rules: [{ kind: 'first_n_rides', n: 3 }] })
    expect(repo.createOfferTx).toHaveBeenLastCalledWith(client, 3n, expect.objectContaining({ perUserLimit: 3 }))
    await request(app).post('/admin/offers').send({ ...body, rules: [{ kind: 'first_n_rides', n: 3 }], perUserLimit: 2 })
    expect(repo.createOfferTx).toHaveBeenLastCalledWith(client, 3n, expect.objectContaining({ perUserLimit: 2 }))
    await request(app).post('/admin/offers').send({ ...body, rules: [{ kind: 'new_user' }], perUserLimit: 5 })
    expect(repo.createOfferTx).toHaveBeenLastCalledWith(client, 3n, expect.objectContaining({ perUserLimit: 1 }))
  })
  it('a non-numeric id is a 404, never a 500', async () => {
    expect((await request(app).get('/admin/offers/abc')).status).toBe(404)
    expect((await request(app).get('/admin/offers/12.5/stats')).status).toBe(404)
  })
  it('endsAt must be after startsAt, and a schedule rule cannot start after it ends', async () => {
    const res = await request(app).post('/admin/offers').send({ ...body, startsAt: '2026-12-02T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' })
    expect(res.status).toBe(422)
    const sched = await request(app).post('/admin/offers').send({ ...body, rules: [{ kind: 'schedule', startDate: '2026-12-10', endDate: '2026-12-01' }] })
    expect(sched.status).toBe(422)
  })
  it('a budget below what is already spent is refused, even on a paused offer', async () => {
    repo.lockOfferForUpdate.mockResolvedValue({ status: 'paused', budget_total: '500', budget_spent: '300', starts_at: null, code: null })
    expect((await request(app).patch('/admin/offers/5').send({ budgetTotal: 200 })).status).toBe(422)
    expect((await request(app).patch('/admin/offers/5').send({ budgetTotal: 300 })).status).toBe(200)
  })
})

describe('versions and status', () => {
  it('POST /:id/versions creates version N+1 and never patches the existing version', async () => {
    const res = await request(app).post('/admin/offers/5/versions').send({ benefit: { type: 'percent_off', percent: 12 } })
    expect(res.status).toBe(201)
    expect(repo.createVersionTx).toHaveBeenCalledTimes(1)
    expect(repo.patchOfferTx).not.toHaveBeenCalled()
    expect(recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'offer.version', afterState: { version: 2 } }))
  })
  it('a status change is audited as offer.status; a paused offer can resume but an ended one cannot', async () => {
    repo.lockOfferForUpdate.mockResolvedValue({ status: 'paused', budget_total: null, budget_spent: '0', starts_at: null, code: 'SAVE10' })
    expect((await request(app).patch('/admin/offers/5').send({ status: 'active' })).status).toBe(200)
    expect(recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'offer.status' }))
    repo.lockOfferForUpdate.mockResolvedValue({ status: 'ended', budget_total: null, budget_spent: '0', starts_at: null, code: 'SAVE10' })
    const res = await request(app).patch('/admin/offers/5').send({ status: 'active' })
    expect(res.status).toBe(422)
    expect(JSON.stringify(res.body)).toMatch(/INVALID_TRANSITION/)
  })
  it('the budget of a live offer can only go up', async () => {
    repo.lockOfferForUpdate.mockResolvedValue({ status: 'active', budget_total: '500', budget_spent: '0', starts_at: null, code: null })
    expect((await request(app).patch('/admin/offers/5').send({ budgetTotal: 400 })).status).toBe(422)
    expect((await request(app).patch('/admin/offers/5').send({ budgetTotal: 600 })).status).toBe(200)
  })
  it('PATCH refuses fields it does not own (economic edits go through /versions)', async () => {
    expect((await request(app).patch('/admin/offers/5').send({ benefit: { type: 'percent_off', percent: 1 } })).status).toBe(422)
  })
  it('an unknown offer is a 404', async () => {
    repo.getOfferAdmin.mockResolvedValue(null)
    expect((await request(app).get('/admin/offers/99')).status).toBe(404)
  })
})

describe('GET /meta', () => {
  it('lists the catalog and the capability flags', async () => {
    const res = await request(app).get('/admin/offers/meta')
    expect(res.status).toBe(200)
    expect(res.body.rules.length).toBe(9)
    expect(res.body.benefits.map((b: { type: string }) => b.type)).toContain('flat_off')
    expect(res.body.capabilities).toMatchObject({ cashback: false, cashDiscounts: false })
  })
  it('cashDiscounts is false whenever cash collection is off, even with the offers flag on', async () => {
    cfg.values['offers_cash_discounts_enabled'] = 'true'
    expect((await request(app).get('/admin/offers/meta')).body.capabilities.cashDiscounts).toBe(true)
    cfg.values['cash_collection_enabled'] = 'false'
    expect((await request(app).get('/admin/offers/meta')).body.capabilities.cashDiscounts).toBe(false)
  })
})

describe('simulate', () => {
  it('shows what the current version would do for a sample ride, with the reason when it would not apply', async () => {
    repo.getOfferAdmin.mockResolvedValue({ offer: row, versions: [{ ...version, rules: [{ kind: 'min_fare', amount: 500 }] }] })
    const fare = { base: 400, distance: 0, time: 0, stop: 0, hourSurcharge: 0, waiting: 0, surge: 54, overage: 0 }
    const no = await request(app).post('/admin/offers/5/simulate').send({ fare, ride: {} })
    expect(no.body).toMatchObject({ eligible: false, reason: 'MIN_FARE', message: 'Add ₹46 more to use this offer' })
    repo.getOfferAdmin.mockResolvedValue({ offer: row, versions: [version] })
    const yes = await request(app).post('/admin/offers/5/simulate').send({ fare, ride: {} })
    expect(yes.body).toMatchObject({ eligible: true, discount: 40 })
  })
})

describe('list, counts, redemption filters and the draft preview (PR3)', () => {
  it('the list returns the offers with a summary and the per-status counts for the tabs', async () => {
    const res = await request(app).get('/admin/offers?status=active')
    expect(res.status).toBe(200)
    expect(res.body.counts).toEqual({ active: 2, draft: 1 })
    expect(res.body.offers[0].summary).toBe('10% off')
    expect(repo.listOffersAdmin).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }))
  })

  it('redemptions pass a status and date window through, and reject a bad status with 422', async () => {
    const ok = await request(app).get('/admin/offers/5/redemptions?status=consumed&from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z')
    expect(ok.status).toBe(200)
    expect(repo.listRedemptions).toHaveBeenCalledWith(5n, 50, 0, { status: 'consumed', from: '2026-11-01T00:00:00Z', to: '2026-11-30T00:00:00Z' })
    expect((await request(app).get('/admin/offers/5/redemptions?status=nope')).status).toBe(422)
  })

  it('preview-draft returns only the sentence without a sample ride', async () => {
    const res = await request(app).post('/admin/offers/preview-draft').send({
      rules: [{ kind: 'new_user' }], benefit: { type: 'percent_off', percent: 10, maxDiscount: 50 },
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ summary: '10% off, max ₹50, new users' })
  })

  it('preview-draft runs a sample ride and says why a rule fails; nothing is saved', async () => {
    const fare = { base: 400, distance: 0, time: 0, stop: 0, hourSurcharge: 0, waiting: 0, surge: 0, overage: 0 }
    const body = { rules: [{ kind: 'min_fare', amount: 500 }], benefit: { type: 'percent_off', percent: 10 }, sample: { fare, ride: {} } }
    const no = await request(app).post('/admin/offers/preview-draft').send(body)
    expect(no.body).toMatchObject({ eligible: false, reason: 'MIN_FARE', message: 'Add ₹100 more to use this offer' })
    const yes = await request(app).post('/admin/offers/preview-draft').send({ ...body, rules: [] })
    expect(yes.body).toMatchObject({ eligible: true, discount: 40 })
    expect(repo.createOfferTx).not.toHaveBeenCalled()
  })

  it('preview-draft rejects an invalid rule with 422 and is readable by finance', async () => {
    expect((await request(app).post('/admin/offers/preview-draft').send({ rules: [{ kind: 'min_fare', amount: -1 }], benefit: { type: 'percent_off', percent: 10 } })).status).toBe(422)
    role.current = 'finance_admin'
    expect((await request(app).post('/admin/offers/preview-draft').send({ benefit: { type: 'percent_off', percent: 10 } })).status).toBe(200)
  })
})
