import { describe, expect, it } from 'vitest'
import { nextReminder } from './kyc-reminders.rules'

const DAY = 86_400_000
const t0 = new Date('2026-11-01T05:00:00Z')
const at = (days: number) => new Date(t0.getTime() + days * DAY)
const base = { lastProgressAt: t0, enabled: true, days: [1, 4, 8] as [number, number, number], pauseDay: 10 }

describe('nextReminder', () => {
  it('is nothing before the first day', () => {
    expect(nextReminder({ ...base, now: at(0.5), sentSinceProgress: 0 })).toBeNull()
  })
  it('first reminder at day 1', () => {
    expect(nextReminder({ ...base, now: at(1), sentSinceProgress: 0 })).toBe(1)
  })
  it('a late sweep sends one message, never a burst', () => {
    expect(nextReminder({ ...base, now: at(5), sentSinceProgress: 0 })).toBe(1)
    expect(nextReminder({ ...base, now: at(5), sentSinceProgress: 1 })).toBe(2)
  })
  it('third reminder at day 8, then nothing more', () => {
    expect(nextReminder({ ...base, now: at(9), sentSinceProgress: 2 })).toBe(3)
    expect(nextReminder({ ...base, now: at(9), sentSinceProgress: 3 })).toBeNull()
  })
  it('does not repeat a reminder that was already sent', () => {
    expect(nextReminder({ ...base, now: at(1.5), sentSinceProgress: 1 })).toBeNull()
  })
  it('is paused from the pause day on', () => {
    expect(nextReminder({ ...base, now: at(10), sentSinceProgress: 2 })).toBeNull()
  })
  it('sends nothing when switched off', () => {
    expect(nextReminder({ ...base, now: at(2), sentSinceProgress: 0, enabled: false })).toBeNull()
  })
})
