import { describe, expect, it } from 'vitest'
import { isEligibleForReview, type ReviewState } from './reviewModel'

const DAY = 24 * 60 * 60 * 1000
const now = 1_000 * DAY
const state: ReviewState = { firstOpenAt: now - 30 * DAY, lastPromptAt: null, promptCount: 0 }
const facts = { now, lifetimeRides: 20, busy: false, updateShownThisSession: false, promptedThisSession: false }

describe('isEligibleForReview', () => {
  it('prompts an established, idle user', () => {
    expect(isEligibleForReview('rider', state, facts)).toBe(true)
    expect(isEligibleForReview('driver', state, facts)).toBe(true)
  })
  it('needs enough lifetime rides (rider 3, driver 10)', () => {
    expect(isEligibleForReview('rider', state, { ...facts, lifetimeRides: 2 })).toBe(false)
    expect(isEligibleForReview('rider', state, { ...facts, lifetimeRides: 3 })).toBe(true)
    expect(isEligibleForReview('driver', state, { ...facts, lifetimeRides: 9 })).toBe(false)
  })
  it('needs enough days since first launch (rider 7, driver 14), and a recorded first launch', () => {
    expect(isEligibleForReview('rider', { ...state, firstOpenAt: now - 6 * DAY }, facts)).toBe(false)
    expect(isEligibleForReview('rider', { ...state, firstOpenAt: now - 7 * DAY }, facts)).toBe(true)
    expect(isEligibleForReview('driver', { ...state, firstOpenAt: now - 13 * DAY }, facts)).toBe(false)
    expect(isEligibleForReview('rider', { ...state, firstOpenAt: null }, facts)).toBe(false)
  })
  it('respects the 120-day cooldown and the 3-prompt lifetime cap', () => {
    expect(isEligibleForReview('rider', { ...state, lastPromptAt: now - 119 * DAY, promptCount: 1 }, facts)).toBe(false)
    expect(isEligibleForReview('rider', { ...state, lastPromptAt: now - 120 * DAY, promptCount: 1 }, facts)).toBe(true)
    expect(isEligibleForReview('rider', { ...state, lastPromptAt: now - 400 * DAY, promptCount: 3 }, facts)).toBe(false)
  })
  it('never while busy, after an update surface, or twice in a session', () => {
    expect(isEligibleForReview('rider', state, { ...facts, busy: true })).toBe(false)
    expect(isEligibleForReview('rider', state, { ...facts, updateShownThisSession: true })).toBe(false)
    expect(isEligibleForReview('rider', state, { ...facts, promptedThisSession: true })).toBe(false)
  })
})
