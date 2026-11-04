import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/config', () => ({ config: { NODE_ENV: 'test' } }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn() }, workerPool: {}, analyticsPool: {} }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() }, getJSON: vi.fn(), setWithTTL: vi.fn() }))
vi.mock('@/jobs/queues', () => ({ queues: {} }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/cache/reference-cache', () => ({ cachedRead: vi.fn(), invalidate: vi.fn() }))

import { pool } from '@/db/client'
import { reserveRedemption, consumeRedemption, releaseRedemption, reverseRedemption } from '@/modules/offers/offers.repository'
import { refreshBudgetGauge } from '@/modules/offers/offers.worker'
import { offersBudgetRemaining, offersRedemptionsTotal, offersReserveRefusedTotal } from '@/observability/offers-metrics'

// Value: protects=each lifecycle step moves its counter exactly once and a refused reservation is counted by reason, the
// budget gauge shows what is left; fails_when=a transition stops counting or counts twice; why_new=Task 12;
// seam=none; no_claim=Prometheus scraping (registry values only).
const value = async (c: { get: () => Promise<{ values: { labels: Record<string, unknown>; value: number }[] }> }, labels: Record<string, string>) =>
  (await c.get()).values.find((v) => Object.entries(labels).every(([k, x]) => v.labels[k] === x))?.value ?? 0

const scripted = (...answers: { rows: unknown[]; rowCount: number }[]) => {
  const q = vi.fn()
  for (const a of answers) q.mockResolvedValueOnce(a)
  q.mockResolvedValue({ rows: [], rowCount: 0 })
  return { query: q } as never
}
const A = { offerId: 5n, versionId: 9n, userId: 3n, rideId: 7n, discount: 40, cashback: 0, perUserLimit: null }

beforeEach(() => { offersRedemptionsTotal.reset(); offersReserveRefusedTotal.reset(); offersBudgetRemaining.reset() })

describe('offers metrics', () => {
  it('a successful reservation counts reserved once', async () => {
    const c = scripted({ rows: [], rowCount: 0 }, { rows: [{ count: 1 }], rowCount: 1 }, { rows: [{ id: '5' }], rowCount: 1 }, { rows: [{ id: '1' }], rowCount: 1 })
    expect((await reserveRedemption(c, A)).ok).toBe(true)
    expect(await value(offersRedemptionsTotal as never, { status: 'reserved' })).toBe(1)
  })

  it('a refused reservation is counted by reason and does not count as reserved', async () => {
    const c = scripted({ rows: [], rowCount: 0 }, { rows: [{ count: 1 }], rowCount: 1 }, { rows: [], rowCount: 0 }, { rows: [{ status: 'active', budget_ok: false }], rowCount: 1 })
    expect(await reserveRedemption(c, A)).toEqual({ ok: false, reason: 'BUDGET' })
    expect(await value(offersReserveRefusedTotal as never, { reason: 'BUDGET' })).toBe(1)
    expect(await value(offersRedemptionsTotal as never, { status: 'reserved' })).toBe(0)
  })

  it('consume, release and reverse each count once, and a no-op counts nothing', async () => {
    const row = { rows: [{ discount_amount: '40', cashback_amount: '0', user_id: '3', offer_id: '5' }], rowCount: 1 }
    await consumeRedemption(scripted(row), 7n)
    await consumeRedemption(scripted({ rows: [], rowCount: 0 }), 7n)
    expect(await value(offersRedemptionsTotal as never, { status: 'consumed' })).toBe(1)
    await releaseRedemption(scripted(row), 7n, 'x')
    await releaseRedemption(scripted({ rows: [], rowCount: 0 }), 7n, 'x')
    expect(await value(offersRedemptionsTotal as never, { status: 'released' })).toBe(1)
    await reverseRedemption(scripted(row), 7n, 'x')
    expect(await value(offersRedemptionsTotal as never, { status: 'reversed' })).toBe(1)
  })

  it('the budget gauge shows what is left per live offer and drops offers that are gone', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: '5', left: '90.00' }, { id: '6', left: '0.00' }], rowCount: 2 } as never)
    expect(await refreshBudgetGauge()).toBe(2)
    expect(await value(offersBudgetRemaining as never, { offer: '5' })).toBe(90)
    expect(await value(offersBudgetRemaining as never, { offer: '6' })).toBe(0)
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: '6', left: '10.00' }], rowCount: 1 } as never)
    await refreshBudgetGauge()
    expect((await (offersBudgetRemaining as never as { get: () => Promise<{ values: unknown[] }> }).get()).values).toHaveLength(1)
  })
})
