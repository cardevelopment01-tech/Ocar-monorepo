import { describe, expect, it } from 'vitest'
import { clockOf, countdown, driveLine, guidance, inLabel, phaseOf, stageOf, whenLabel } from './format'

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

describe('stageOf', () => {
  const t = now.getTime()
  // pickup 10:45 (t+60), goes live 15 min before (t+45), leave by 27 min before (t+33)
  const r = { leaveBy: new Date(t + 33 * MIN).toISOString(), opensAt: new Date(t + 45 * MIN).toISOString() }
  it('moves from later, to the leave-by time, to head out, to the countdown', () => {
    expect(stageOf(r, t)).toBe('later')                         // 33 min to leave-by: not yet within the half hour
    expect(stageOf(r, t + 4 * MIN)).toBe('leaveby')             // 29 min to leave-by
    expect(stageOf(r, t + 33 * MIN)).toBe('headout')
    expect(stageOf(r, t + 39 * MIN)).toBe('headout')
    expect(stageOf(r, t + 40 * MIN)).toBe('opens')              // 5 min before it goes live
    expect(stageOf(r, t + 50 * MIN)).toBe('opens')
  })
  it('a driver close to the pickup skips straight to the countdown (leave-by is after the lead-in starts)', () => {
    const near = { leaveBy: new Date(t + 44 * MIN).toISOString(), opensAt: new Date(t + 45 * MIN).toISOString() }
    expect(stageOf(near, t + 41 * MIN)).toBe('opens')
  })
})

describe('countdown, clockOf, driveLine', () => {
  it('counts down in m:ss and stops at zero', () => {
    expect(countdown(1_000_000 + 252_000, 1_000_000)).toBe('4:12')
    expect(countdown(1_000_000 + 9_000, 1_000_000)).toBe('0:09')
    expect(countdown(1_000_000, 1_000_000 + 5_000)).toBe('0:00')
  })
  it('reads a clock and a drive in plain words', () => {
    expect(clockOf(new Date(2026, 10, 26, 10, 27).toISOString())).toBe('10:27 AM')
    expect(driveLine(18)).toBe('The pickup is about 18 min away')
    expect(driveLine(null)).toMatch(/about 30 min/)
  })
})
