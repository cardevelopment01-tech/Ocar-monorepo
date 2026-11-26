import { describe, expect, it } from 'vitest'
import { guidance, inLabel, phaseOf, whenLabel } from './format'

const MIN = 60_000
const now = new Date(2026, 10, 26, 14, 0, 0) // 26 Nov 2026, 2:00 PM local

describe('phaseOf', () => {
  it('follows the time to the pickup', () => {
    const t = now.getTime()
    expect(phaseOf(t + 3 * 60 * MIN, t)).toBe('later')
    expect(phaseOf(t + 61 * MIN, t)).toBe('later')
    expect(phaseOf(t + 60 * MIN, t)).toBe('soon')
    expect(phaseOf(t + 31 * MIN, t)).toBe('soon')
    expect(phaseOf(t + 30 * MIN, t)).toBe('ready')
    expect(phaseOf(t + 1 * MIN, t)).toBe('ready')
    expect(phaseOf(t, t)).toBe('due')
    expect(phaseOf(t - 5 * MIN, t)).toBe('due')
  })
})

describe('whenLabel', () => {
  it('says today, tomorrow, then the date', () => {
    expect(whenLabel(new Date(2026, 10, 26, 18, 0), now)).toMatch(/^Today, 6:00 PM$/)
    expect(whenLabel(new Date(2026, 10, 27, 9, 30), now)).toMatch(/^Tomorrow, 9:30 AM$/)
    expect(whenLabel(new Date(2026, 10, 28, 18, 0), now)).toMatch(/^Sat 28 Nov, 6:00 PM$/)
  })
  it('a pickup just after midnight is tomorrow, not today', () => {
    expect(whenLabel(new Date(2026, 10, 27, 0, 15), new Date(2026, 10, 26, 23, 50))).toMatch(/^Tomorrow, 12:15 AM$/)
  })
})

describe('inLabel', () => {
  it('reads like a person would say it', () => {
    const t = now.getTime()
    expect(inLabel(t - MIN, t)).toBe('now')
    expect(inLabel(t + 24 * MIN, t)).toBe('in 24 min')
    expect(inLabel(t + 60 * MIN, t)).toBe('in 1h')
    expect(inLabel(t + 102 * MIN, t)).toBe('in 1h 42m')
    expect(inLabel(t + 49 * 60 * MIN, t)).toBe('in 2 days')
  })
})

describe('guidance', () => {
  it('asks to confirm when unconfirmed, and tells the truth about what is held back', () => {
    expect(guidance('later', false)).toMatch(/Confirm/)
    expect(guidance('soon', false)).toMatch(/confirm now/)
    expect(guidance('later', true)).toMatch(/finish in time/)
    expect(guidance('ready', true)).toMatch(/near the pickup/)
    expect(guidance('due', true)).toMatch(/time has come/)
  })
})
