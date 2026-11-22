import { describe, it, expect } from 'vitest'
import { fmtIst, istDay, elapsed, fmtIstDay } from '../ist'

describe('fmtIst', () => {
  it('shows IST regardless of the machine time zone (18:30 UTC is midnight in India)', () => {
    expect(fmtIst('2026-11-20T18:30:00Z')).toMatch(/21 Nov/)
    expect(fmtIst('2026-11-20T18:30:00Z')).toMatch(/12:00/)
  })
  it('dashes a missing or invalid time', () => {
    expect(fmtIst(null)).toBe('—')
    expect(fmtIst('nope')).toBe('—')
  })
  it('can include the year', () => { expect(fmtIst('2026-11-20T10:00:00Z', true)).toMatch(/2026/) })
})

describe('istDay', () => {
  it('uses the Indian calendar day, not the UTC one', () => {
    const lateUtc = new Date('2026-11-20T19:00:00Z') // already 21 Nov 00:30 in India
    expect(istDay(0, lateUtc)).toBe('2026-11-21')
    expect(istDay(1, lateUtc)).toBe('2026-11-20')
  })
})

describe('elapsed', () => {
  it('formats seconds and minutes', () => {
    expect(elapsed('2026-01-01T00:00:00Z', '2026-01-01T00:00:12Z')).toBe('12s')
    expect(elapsed('2026-01-01T00:00:00Z', '2026-01-01T00:01:05Z')).toBe('1m 05s')
  })
  it('is null when a time is missing or runs backwards', () => {
    expect(elapsed(null, '2026-01-01T00:00:00Z')).toBeNull()
    expect(elapsed('2026-01-01T00:00:10Z', '2026-01-01T00:00:00Z')).toBeNull()
  })
})

describe('fmtIstDay', () => {
  const now = new Date('2026-11-23T04:30:00Z') // 10:00 am in India on 23 Nov
  it('says Today and Tomorrow in IST days', () => {
    expect(fmtIstDay('2026-11-23T13:00:00Z', now)).toBe('Today, 6:30 pm')
    expect(fmtIstDay('2026-11-24T01:00:00Z', now)).toBe('Tomorrow, 6:30 am')
  })
  it('uses the Indian day, not the UTC one (19:00 UTC is already tomorrow in India)', () => {
    expect(fmtIstDay('2026-11-23T19:00:00Z', now)).toMatch(/^Tomorrow, 12:30 am$/)
  })
  it('names the weekday and date further out', () => {
    expect(fmtIstDay('2026-11-27T04:30:00Z', now)).toBe('Fri, 27 Nov, 10:00 am')
  })
  it('dashes a missing time', () => { expect(fmtIstDay(null, now)).toBe('—') })
})
