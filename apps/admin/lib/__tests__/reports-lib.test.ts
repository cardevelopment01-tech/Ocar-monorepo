import { describe, it, expect } from 'vitest'
import {
  inr, inrCompact, pct, shortDate, completionRate, cancellationRate, relativeDelta, pointsDelta, deltaText,
} from '../reports-format'
import { parseFilters, toSearchParams, resolvePreset, validateRange, apiParams } from '../reports-range'

describe('reports-format', () => {
  it('formats rupees en-IN, full and compact', () => {
    expect(inr(122000)).toBe('₹1,22,000')
    expect(inrCompact(0)).toBe('₹0')
    expect(inrCompact(950)).toBe('₹950')
    expect(inrCompact(2200)).toBe('₹2.2k')
    expect(inrCompact(120000)).toBe('₹1.2L')
    expect(inrCompact(34000000)).toBe('₹3.4Cr')
    expect(inrCompact(-2200)).toBe('-₹2.2k')
  })

  it('percent shows an en dash for unknown, never NaN', () => {
    expect(pct(0.256)).toBe('26%')
    expect(pct(null)).toBe('–')
    expect(pct(Number.NaN)).toBe('–')
  })

  it('short dates are day + month', () => {
    expect(shortDate('2026-09-18')).toMatch(/^18 Sep/)
  })

  it('rates are a requested cohort and null (not 0) when there are no rides', () => {
    expect(completionRate({ cohort_completed: 3, cohort_cancelled: 1 })).toBe(0.75)
    expect(cancellationRate({ cohort_completed: 3, cohort_cancelled: 1 })).toBe(0.25)
    expect(completionRate({ cohort_completed: 0, cohort_cancelled: 0 })).toBeNull()
  })

  it('no delta against an empty or missing previous window (never NaN or +Infinity%)', () => {
    expect(relativeDelta(10, 0)).toBeNull()
    expect(relativeDelta(10, null)).toBeNull()
    expect(relativeDelta(10, undefined)).toBeNull()
    expect(pointsDelta(0.5, null)).toBeNull()
    expect(pointsDelta(null, 0.5)).toBeNull()
  })

  it('relative delta direction and text', () => {
    const up = relativeDelta(120, 100)!
    expect(up.direction).toBe('up')
    expect(deltaText(up)).toBe('+20%')
    expect(deltaText(relativeDelta(80, 100)!)).toBe('−20%')
    expect(relativeDelta(100, 100)!.direction).toBe('flat')
  })

  it('rate delta is in percentage points', () => {
    const d = pointsDelta(0.6, 0.5)!
    expect(d.kind).toBe('points')
    expect(deltaText(d)).toBe('+10.0 pts')
  })
})

describe('reports-range (URL state)', () => {
  const now = new Date('2026-09-29T10:00:00Z') // 29 Sep IST

  it('defaults: overview, 30d, compare on', () => {
    const f = parseFilters(new URLSearchParams(), now)
    expect(f).toMatchObject({ tab: 'overview', range: '30d', from: '2026-08-31', to: '2026-09-29', compare: 'prev', cityIds: [], categoryId: null })
  })

  it('presets resolve to IST calendar dates', () => {
    expect(resolvePreset('7d', now)).toEqual({ from: '2026-09-23', to: '2026-09-29' })
    expect(resolvePreset('90d', now)).toEqual({ from: '2026-07-02', to: '2026-09-29' })
    expect(resolvePreset('month', now)).toEqual({ from: '2026-09-01', to: '2026-09-29' })
    expect(resolvePreset('lastmonth', now)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
  })

  it('a UTC late-evening instant is already the next IST day', () => {
    expect(resolvePreset('7d', new Date('2026-09-28T20:00:00Z')).to).toBe('2026-09-29')
  })

  it('round-trips through the query string and omits defaults', () => {
    const f = parseFilters(new URLSearchParams('tab=drivers&range=custom&from=2026-09-01&to=2026-09-10&city=1,2&cat=3&cmp=off'), now)
    expect(f).toMatchObject({ tab: 'drivers', range: 'custom', from: '2026-09-01', to: '2026-09-10', cityIds: ['1', '2'], categoryId: '3', compare: 'off' })
    expect(parseFilters(toSearchParams(f), now)).toEqual(f)
    expect(toSearchParams(parseFilters(new URLSearchParams(), now)).toString()).toBe('')
  })

  it('bad values fall back instead of throwing', () => {
    const f = parseFilters(new URLSearchParams('tab=nope&range=xx&city=a,2&cat=zz&from=bad&to=worse'), now)
    expect(f).toMatchObject({ tab: 'overview', range: '30d', cityIds: ['2'], categoryId: null })
  })

  it('validates custom ranges with text the user can act on', () => {
    expect(validateRange('2026-09-01', '2026-09-10')).toBeNull()
    expect(validateRange('2026-09-10', '2026-09-01')).toMatch(/start date/)
    expect(validateRange('', '2026-09-01')).toMatch(/both dates/)
    expect(validateRange('2025-01-01', '2026-09-01')).toMatch(/366/)
  })

  it('API params carry resolved dates, filters and the comparison mode', () => {
    const f = parseFilters(new URLSearchParams('city=1,2&cat=3&cmp=off'), now)
    expect(apiParams(f)).toEqual({ from: '2026-08-31', to: '2026-09-29', compare: 'off', cityIds: '1,2', categoryId: '3' })
  })
})
