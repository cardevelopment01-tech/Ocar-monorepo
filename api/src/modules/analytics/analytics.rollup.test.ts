import { describe, it, expect, vi } from 'vitest'

vi.mock('@/db/client', () => ({ analyticsPool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))

import { splitRange, viewFilterSql, hasFilters, hasCategory, withRawFallback } from './analytics.rollup'
import { rangeFromIstDates } from './kpi-definitions'

describe('splitRange', () => {
  const range = rangeFromIstDates('2026-10-01', '2026-10-10') // IST days Oct 1..10 inclusive

  it('reads everything from the raw tables when the views were never refreshed', () => {
    const s = splitRange(range, null)
    expect(s.rollup).toBeNull()
    expect(s.live).toEqual(range)
  })

  it('reads days before the refresh day from the views and the rest live', () => {
    const s = splitRange(range, '2026-10-10') // refreshed on Oct 10 IST: Oct 1..9 complete, Oct 10 is live
    expect(s.rollup).toMatchObject({ fromDay: '2026-10-01', toDay: '2026-10-10' })
    expect(s.live!.end).toEqual(range.end)
    expect(s.live!.end.getTime() - s.live!.start.getTime()).toBe(86_400_000)
  })

  it('has no live part when the whole range is before the refresh day', () => {
    const s = splitRange(range, '2026-10-20')
    expect(s.rollup).toMatchObject({ fromDay: '2026-10-01', toDay: '2026-10-11' })
    expect(s.live).toBeNull()
  })

  it('is all live when the refresh is older than the range start', () => {
    const s = splitRange(range, '2026-09-01')
    expect(s.rollup).toBeNull()
    expect(s.live).toEqual(range)
  })

  it('splits a stale refresh into a long live tail', () => {
    const s = splitRange(range, '2026-10-06')
    expect(s.rollup).toMatchObject({ fromDay: '2026-10-01', toDay: '2026-10-06' })
    expect((s.live!.end.getTime() - s.live!.start.getTime()) / 86_400_000).toBe(5) // Oct 6..10
  })
})

describe('view filters', () => {
  it('maps city and category to the view columns with the right placeholders', () => {
    const f = viewFilterSql({ cityIds: [1, 2], categoryId: 3 }, 3)
    expect(f.sql).toBe('AND city_id = ANY($3::bigint[]) AND category_id = $4')
    expect(f.params).toEqual([[1, 2], 3])
  })
  it('can leave a dimension out when the view does not have it', () => {
    expect(viewFilterSql({ cityIds: [1], categoryId: 3 }, 3, { city: true, category: false }).sql).toBe('AND city_id = ANY($3::bigint[])')
    expect(viewFilterSql({ cityIds: [1], categoryId: 3 }, 3, { city: false, category: true }).sql).toBe('AND category_id = $3')
  })
  it('reports whether any filter is present', () => {
    expect(hasFilters({})).toBe(false)
    expect(hasFilters({ cityIds: [] })).toBe(false)
    expect(hasFilters({ cityIds: [1] })).toBe(true)
    expect(hasCategory({ categoryId: 2 })).toBe(true)
    expect(hasCategory({ cityIds: [1] })).toBe(false)
  })
})

describe('withRawFallback', () => {
  it('uses the rollup path when it works', async () => {
    expect(await withRawFallback('x', async () => 'rollup', async () => 'raw')).toBe('rollup')
  })
  it('falls back to the raw path when the rollup path throws', async () => {
    expect(await withRawFallback('x', async () => { throw new Error('relation "rpt_completed" does not exist') }, async () => 'raw')).toBe('raw')
  })
})
