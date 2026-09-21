import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatPickupTime } from './formatPickupTime'

describe('formatPickupTime', () => {
  const originalTz = process.env['TZ']

  beforeAll(() => {
    // Pin the process timezone so both `new Date(...)` local-component
    // construction below and formatPickupTime's own un-zoned
    // toLocaleString calls agree on the same wall clock, regardless of
    // whatever timezone the machine running this test happens to be in.
    process.env['TZ'] = 'Asia/Kolkata'
  })

  afterAll(() => {
    process.env['TZ'] = originalTz
  })

  beforeEach(() => {
    vi.useFakeTimers()
    // Wed 16 Sep 2026, 08:00 local -- mid-day/mid-week so the "today"/
    // "tomorrow" boundaries below are never ambiguous.
    vi.setSystemTime(new Date(2026, 8, 16, 8, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('labels a time later the same day as "Today, <time>"', () => {
    expect(formatPickupTime(new Date(2026, 8, 16, 18, 30))).toBe('Today, 6:30 pm')
  })

  it('labels a time on the next calendar day as "Tomorrow, <time>"', () => {
    expect(formatPickupTime(new Date(2026, 8, 17, 8, 0))).toBe('Tomorrow, 8:00 am')
  })

  it('labels anything further out as "<weekday> <day>, <time>"', () => {
    expect(formatPickupTime(new Date(2026, 8, 19, 18, 30))).toBe('Sat 19, 6:30 pm')
  })

  it("lowercases am/pm to match the rest of the app's copy", () => {
    const result = formatPickupTime(new Date(2026, 8, 16, 10, 0))
    expect(result).not.toMatch(/AM|PM/)
    expect(result).toMatch(/am|pm/)
  })
})
