import { describe, expect, it } from 'vitest'
import { nextReminder, pausesAt, reminderCycle, type ReminderInput } from './kyc-reminders.rules'

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

describe('catch-up for a driver who was already past the pause day before any reminder', () => {
  const old = (now: Date, over: Partial<ReminderInput> = {}): ReminderInput => ({ ...base, now, catchUp: true, sentSinceProgress: 0, ...over })
  const firstAt = at(40) // first catch-up reminder, 40 days after their last step
  it('does nothing unless the setting is on', () => {
    expect(nextReminder({ ...base, now: at(40), sentSinceProgress: 0 })).toBeNull()
    expect(nextReminder({ ...base, now: at(40), sentSinceProgress: 0, catchUp: false })).toBeNull()
  })
  it('sends the first reminder at once, then the same spacing as a new driver (day 4 and 8 after the first, counted from it)', () => {
    expect(nextReminder(old(at(40), { sentSinceProgress: 0 }))).toBe(1)
    expect(nextReminder(old(at(41), { sentSinceProgress: 1, firstSentAt: firstAt }))).toBeNull()
    expect(nextReminder(old(at(43), { sentSinceProgress: 1, firstSentAt: firstAt }))).toBe(2)
    expect(nextReminder(old(at(47), { sentSinceProgress: 2, firstSentAt: firstAt }))).toBe(3)
  })
  it('pauses again at the pause day of its own cycle, and the pause date moves with it', () => {
    expect(nextReminder(old(at(40 + 9), { sentSinceProgress: 2, firstSentAt: firstAt }))).toBeNull()
    expect(pausesAt(reminderCycle(old(at(43), { firstSentAt: firstAt })), 10).getTime()).toBe(at(40 + 9).getTime())
  })
  it('stops if the setting is switched off part way', () => {
    expect(nextReminder(old(at(43), { sentSinceProgress: 1, firstSentAt: firstAt, catchUp: false }))).toBeNull()
  })
  it('leaves a driver alone who already had the normal reminders, even long after', () => {
    expect(nextReminder(old(at(40), { sentSinceProgress: 3, firstSentAt: at(1) }))).toBeNull()
    expect(nextReminder(old(at(40), { sentSinceProgress: 1, firstSentAt: at(1) }))).toBeNull()
  })
  it('does not touch a new driver inside the normal window', () => {
    expect(nextReminder(old(at(1), { sentSinceProgress: 0 }))).toBe(1)
    expect(reminderCycle(old(at(1))).catchUp).toBe(false)
  })
})
