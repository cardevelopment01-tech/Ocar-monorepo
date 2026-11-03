import { describe, expect, it } from 'vitest'
import { SOFT_SNOOZE_MS, decideUpdateUi } from './updateState'

const base = { forcedHard: false, busy: false, snoozedUntil: 0, now: 1_000 }

describe('decideUpdateUi', () => {
  it('shows nothing when no update is wanted', () => {
    expect(decideUpdateUi({ ...base, action: 'none' })).toBeNull()
  })
  it('hard policy blocks, soft policy asks', () => {
    expect(decideUpdateUi({ ...base, action: 'hard' })).toBe('hard')
    expect(decideUpdateUi({ ...base, action: 'soft' })).toBe('soft')
  })
  it('a snoozed soft prompt stays quiet until the snooze ends, a hard one is never snoozed', () => {
    const snoozedUntil = base.now + SOFT_SNOOZE_MS
    expect(decideUpdateUi({ ...base, action: 'soft', snoozedUntil })).toBeNull()
    expect(decideUpdateUi({ ...base, action: 'soft', snoozedUntil, now: snoozedUntil })).toBe('soft')
    expect(decideUpdateUi({ ...base, action: 'hard', snoozedUntil })).toBe('hard')
  })
  it('never interrupts a busy user, hard or soft', () => {
    expect(decideUpdateUi({ ...base, action: 'hard', busy: true })).toBeNull()
    expect(decideUpdateUi({ ...base, action: 'soft', busy: true })).toBeNull()
  })
  it('a 426 shows the block even while busy (the user just tried to start something)', () => {
    expect(decideUpdateUi({ ...base, action: 'none', forcedHard: true, busy: true })).toBe('hard')
  })
})
