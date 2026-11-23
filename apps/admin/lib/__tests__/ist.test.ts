import { describe, it, expect } from 'vitest'
import { fmtIst, istDay, elapsed } from '../ist'

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
