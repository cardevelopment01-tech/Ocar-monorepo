import { describe, it, expect } from 'vitest'
import {
  istDayStartUtc,
  istDateOf,
  rangeFromIstDates,
  previousRange,
  ridesFilterSql,
  completionRate,
  cancellationRate,
  takeRate,
  kpiTotalsSql,
  parseKpiTotals,
} from '@/modules/analytics/kpi-definitions'
import { parseRange, InvalidRangeError, MAX_CITY_IDS } from '@/modules/analytics/analytics.range'

describe('IST day bounds', () => {
  it('midnight IST is 18:30 UTC the day before', () => {
    expect(istDayStartUtc('2026-09-29').toISOString()).toBe('2026-09-28T18:30:00.000Z')
  })

  it('a ride completed at 00:20 IST belongs to the next IST day, one at 23:50 IST to the previous', () => {
    // 23:50 IST 28 Sep = 18:20 UTC 28 Sep; 00:20 IST 29 Sep = 18:50 UTC 28 Sep
    expect(istDateOf(new Date('2026-09-28T18:20:00Z'))).toBe('2026-09-28')
    expect(istDateOf(new Date('2026-09-28T18:50:00Z'))).toBe('2026-09-29')
  })

  it('inclusive IST dates become a half-open UTC range spanning whole days', () => {
    const r = rangeFromIstDates('2026-09-01', '2026-09-30')
    expect(r.start.toISOString()).toBe('2026-08-31T18:30:00.000Z')
    expect(r.end.toISOString()).toBe('2026-09-30T18:30:00.000Z')
  })

  it('previousRange is the equally long window immediately before', () => {
    const r = rangeFromIstDates('2026-09-08', '2026-09-14') // 7 days
    const p = previousRange(r)
    expect(p.end.getTime()).toBe(r.start.getTime())
    expect(r.start.getTime() - p.start.getTime()).toBe(7 * 86_400_000)
  })
})

describe('rates', () => {
  it('completion and cancellation rates are a requested cohort and sum to 1', () => {
    const t = { cohort_completed: 12, cohort_cancelled: 6 }
    expect(completionRate(t)).toBeCloseTo(12 / 18)
    expect(cancellationRate(t)).toBeCloseTo(6 / 18)
  })

  it('are 0 (not NaN) with no rides, and take rate is 0 with no gross', () => {
    expect(completionRate({ cohort_completed: 0, cohort_cancelled: 0 })).toBe(0)
    expect(cancellationRate({ cohort_completed: 0, cohort_cancelled: 0 })).toBe(0)
    expect(takeRate({ gross_bookings: 0, commission: 0 })).toBe(0)
    expect(takeRate({ gross_bookings: 200, commission: 30 })).toBeCloseTo(0.15)
  })
})

describe('ridesFilterSql', () => {
  it('is empty without filters', () => {
    expect(ridesFilterSql(undefined, 3)).toEqual({ sql: '', params: [] })
    expect(ridesFilterSql({}, 3)).toEqual({ sql: '', params: [] })
  })

  it('numbers placeholders from the first free parameter', () => {
    const f = ridesFilterSql({ cityIds: [1, 2], categoryId: 5 }, 3)
    expect(f.params).toEqual([[1, 2], 5])
    expect(f.sql).toContain('ANY($3::bigint[])')
    expect(f.sql).toContain('r.category_id = $4')
  })
})

describe('kpiTotalsSql / parseKpiTotals', () => {
  it('money and completed counts use completed_at; the cohort uses requested_at; only completed payments count', () => {
    const sql = kpiTotalsSql('$1', '$2')
    expect(sql).toContain("p.status = 'completed'")
    expect(sql).toMatch(/r\.completed_at >= \$1/)
    expect(sql).toMatch(/r\.requested_at >= \$1/)
    expect(sql).not.toContain('AT TIME ZONE') // keeps predicates sargable
  })

  it('parses numeric strings from pg and defaults missing columns to 0', () => {
    expect(parseKpiTotals({ gross_bookings: '1200.50', commission: '180', completed_rides: 3 })).toEqual({
      gross_bookings: 1200.5,
      commission: 180,
      completed_rides: 3,
      active_drivers: 0,
      cohort_completed: 0,
      cohort_cancelled: 0,
    })
    expect(parseKpiTotals(undefined).gross_bookings).toBe(0)
  })
})

describe('parseRange', () => {
  const now = new Date('2026-09-29T10:00:00Z') // 15:30 IST, 29 Sep

  it('defaults to the last 30 IST days including today, compare on', () => {
    const p = parseRange({}, now)
    expect(p.to).toBe('2026-09-29')
    expect(p.from).toBe('2026-08-31')
    expect(p.days).toBe(30)
    expect(p.compare).toBe('prev')
    expect(p.previous).not.toBeNull()
  })

  it('accepts the 7d/90d presets (backward compatible with ?period=)', () => {
    expect(parseRange({ period: '7d' }, now).days).toBe(7)
    expect(parseRange({ period: '90d' }, now).days).toBe(90)
  })

  it('accepts custom from/to and turns comparison off', () => {
    const p = parseRange({ from: '2026-09-01', to: '2026-09-30', compare: 'off' }, now)
    expect(p.days).toBe(30)
    expect(p.previous).toBeNull()
  })

  it('rejects from after to, half-given dates, fake dates and ranges over 366 days', () => {
    expect(() => parseRange({ from: '2026-09-30', to: '2026-09-01' }, now)).toThrow(InvalidRangeError)
    expect(() => parseRange({ from: '2026-09-01' }, now)).toThrow(InvalidRangeError)
    expect(() => parseRange({ from: '2026-02-30', to: '2026-03-01' }, now)).toThrow(InvalidRangeError)
    expect(() => parseRange({ from: '2025-01-01', to: '2026-09-01' }, now)).toThrow(/366/)
  })

  it('parses city ids and caps them at 50', () => {
    expect(parseRange({ cityIds: '1,2,3', categoryId: '4' }, now).filters).toEqual({ cityIds: [1, 2, 3], categoryId: 4 })
    const tooMany = Array.from({ length: MAX_CITY_IDS + 1 }, (_, i) => i + 1).join(',')
    expect(() => parseRange({ cityIds: tooMany }, now)).toThrow(InvalidRangeError)
    expect(() => parseRange({ cityIds: '1,abc' }, now)).toThrow(InvalidRangeError)
  })
})
