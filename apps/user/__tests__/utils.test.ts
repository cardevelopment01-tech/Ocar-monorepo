import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clampTripHours, toDatetimeLocal, minReturnDatetimeLocal, formatReturnAt } from '../lib/utils'

const FIXED_NOW = new Date('2026-07-01T06:00:00.000Z')

// ─── clampTripHours ────────────────────────────────────────────────────────────

describe('clampTripHours', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => { vi.useRealTimers() })

  it('returns undefined when returnAt is null', () => {
    expect(clampTripHours(null)).toBeUndefined()
  })

  it('enforces 4h minimum when returnAt is only 1h away', () => {
    const returnAt = new Date(FIXED_NOW.getTime() + 1 * 3_600_000)
    expect(clampTripHours(returnAt)).toBe(4)
  })

  it('returns 4 when returnAt is exactly 4h away', () => {
    const returnAt = new Date(FIXED_NOW.getTime() + 4 * 3_600_000)
    expect(clampTripHours(returnAt)).toBe(4)
  })

  it('returns ceiling when hours are fractional (4.1h → 5)', () => {
    const returnAt = new Date(FIXED_NOW.getTime() + 4.1 * 3_600_000)
    expect(clampTripHours(returnAt)).toBe(5)
  })

  it('returns exact integer for whole-hour gaps', () => {
    const returnAt = new Date(FIXED_NOW.getTime() + 6 * 3_600_000)
    expect(clampTripHours(returnAt)).toBe(6)
  })

  it('returns 10 for a 10h gap', () => {
    const returnAt = new Date(FIXED_NOW.getTime() + 10 * 3_600_000)
    expect(clampTripHours(returnAt)).toBe(10)
  })

  it('enforces 4h minimum even for past dates', () => {
    const returnAt = new Date(FIXED_NOW.getTime() - 1 * 3_600_000)
    expect(clampTripHours(returnAt)).toBe(4)
  })
})

// ─── toDatetimeLocal ───────────────────────────────────────────────────────────

describe('toDatetimeLocal', () => {
  it('produces a string matching datetime-local format', () => {
    const d = new Date()
    expect(toDatetimeLocal(d)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('zero-pads single-digit month, day, hour, and minute', () => {
    // Jan 5 at 03:07 local, use local constructor so padding is exercised
    const d = new Date(2026, 0, 5, 3, 7)
    const result = toDatetimeLocal(d)
    expect(result).toBe('2026-01-05T03:07')
  })

  it('handles double-digit values without extra padding', () => {
    const d = new Date(2026, 11, 31, 23, 59)
    expect(toDatetimeLocal(d)).toBe('2026-12-31T23:59')
  })

  it('is round-trippable: new Date(toDatetimeLocal(d)) ≈ d', () => {
    const d = new Date(2026, 6, 1, 9, 30)
    const str = toDatetimeLocal(d)
    const back = new Date(str)
    // datetime-local has no seconds, diff should be under 60s
    expect(Math.abs(back.getTime() - d.getTime())).toBeLessThan(60_000)
  })
})

// ─── formatReturnAt ────────────────────────────────────────────────────────────

describe('formatReturnAt', () => {
  it('formats a standard afternoon time correctly', () => {
    // 5 Jul 2026 18:30 local, construct in local time
    const d = new Date(2026, 6, 5, 18, 30)
    expect(formatReturnAt(d.toISOString())).toBe('5 Jul · 18:30')
  })

  it('zero-pads single-digit hours and minutes', () => {
    const d = new Date(2026, 6, 5, 9, 5)
    expect(formatReturnAt(d.toISOString())).toBe('5 Jul · 09:05')
  })

  it('handles midnight (00:00)', () => {
    const d = new Date(2026, 6, 5, 0, 0)
    expect(formatReturnAt(d.toISOString())).toBe('5 Jul · 00:00')
  })

  it('handles noon (12:00)', () => {
    const d = new Date(2026, 6, 5, 12, 0)
    expect(formatReturnAt(d.toISOString())).toBe('5 Jul · 12:00')
  })

  it('handles 23:59', () => {
    const d = new Date(2026, 6, 5, 23, 59)
    expect(formatReturnAt(d.toISOString())).toBe('5 Jul · 23:59')
  })

  it('uses correct month abbreviations for all 12 months', () => {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    months.forEach((abbr, i) => {
      const d = new Date(2026, i, 1, 10, 0)
      expect(formatReturnAt(d.toISOString())).toContain(abbr)
    })
  })

  it('uses local hours, does not show UTC hours', () => {
    // Use a known local datetime and verify hours match local, not UTC
    const d = new Date(2026, 6, 5, 18, 30)
    const result = formatReturnAt(d.toISOString())
    const [, timePart] = result.split(' · ')
    const [h] = timePart!.split(':')
    expect(parseInt(h!)).toBe(d.getHours())
  })

  it('output always matches pattern "D Mon · HH:MM"', () => {
    const d = new Date(2026, 6, 15, 14, 45)
    expect(formatReturnAt(d.toISOString())).toMatch(/^\d{1,2} [A-Z][a-z]{2} · \d{2}:\d{2}$/)
  })
})

// ─── minReturnDatetimeLocal ────────────────────────────────────────────────────

describe('minReturnDatetimeLocal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => { vi.useRealTimers() })

  it('returns a string in datetime-local format', () => {
    expect(minReturnDatetimeLocal()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('result is at least 4h after current time', () => {
    const result = minReturnDatetimeLocal()
    const parsed = new Date(result)
    const diffMs = parsed.getTime() - FIXED_NOW.getTime()
    expect(diffMs).toBeGreaterThanOrEqual(4 * 3_600_000 - 60_000)
  })

  it('result is not more than 4h 1min after current time', () => {
    const result = minReturnDatetimeLocal()
    const parsed = new Date(result)
    const diffMs = parsed.getTime() - FIXED_NOW.getTime()
    expect(diffMs).toBeLessThanOrEqual(4 * 3_600_000 + 60_000)
  })
})
