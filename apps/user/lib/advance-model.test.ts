import { describe, it, expect } from 'vitest'
import { cancelCopy, FALLBACK_TERMS, minutesText, rescheduleErrorMessage, termsLines, upcomingStatusLine, type AdvanceTerms } from './advance-model'

const withFee: AdvanceTerms = { ...FALLBACK_TERMS, lateCancel: { windowMin: 60, mode: 'percent', percent: 10, cap: 100, flat: 50 } }

describe('minutesText', () => {
  it.each([[1, '1 minute'], [45, '45 minutes'], [60, '1 hour'], [90, '1 hour 30 minutes']])('%i -> %s', (m, out) => expect(minutesText(m)).toBe(out))
})

describe('termsLines', () => {
  it('says when search starts and that the fare can move a little; no fee line while the policy is off', () => {
    const l = termsLines(FALLBACK_TERMS)
    expect(l[0]).toBe('We start finding your driver 15 minutes before pickup. You can change the time for free until then.')
    expect(l.join(' ')).toContain('may differ a little')
    expect(l.join(' ')).not.toContain('costs')
  })
  it('states the fee up front when it is on', () => {
    expect(termsLines(withFee).at(-1)).toBe('Cancelling within 1 hour of pickup, after a driver has accepted, costs 10% of the fare, up to ₹100. Earlier is free.')
  })
  it('states a flat fee', () => {
    const flat: AdvanceTerms = { ...FALLBACK_TERMS, lateCancel: { windowMin: 30, mode: 'flat', percent: 10, cap: 100, flat: 75 } }
    expect(termsLines(flat).at(-1)).toContain('within 30 minutes of pickup, after a driver has accepted, costs ₹75')
  })
})

describe('cancelCopy', () => {
  const free = { canCancel: true, status: 'scheduled', fee: 0, reason: 'none' as const, freeUntil: null, windowMin: null }
  it('puts the rupee amount on the headline and the button', () => {
    const c = cancelCopy({ ...free, fee: 100, reason: 'late_cancel', windowMin: 60 })
    expect(c.title).toBe('Cancelling costs ₹100')
    expect(c.confirm).toBe('Cancel and pay ₹100')
    expect(c.body).toContain('A driver has accepted and your pickup is within 1 hour')
  })
  it('is plain when free', () => {
    expect(cancelCopy(free).body).toBe('You will not be charged.')
    expect(cancelCopy({ ...free, freeUntil: new Date(Date.now() + 3_600_000).toISOString() }).body).toMatch(/^It is free to cancel until/)
  })
})

describe('rescheduleErrorMessage / upcomingStatusLine', () => {
  it('translates API codes', () => {
    expect(rescheduleErrorMessage('RESCHEDULE_LIMIT', 'x')).toContain('used all the time changes')
    expect(rescheduleErrorMessage('NOT_RESCHEDULABLE', 'x')).toContain('already started looking')
    expect(rescheduleErrorMessage(undefined, 'fallback')).toBe('fallback')
  })
  it('says when search starts, then that we are finding a driver', () => {
    const now = Date.now()
    expect(upcomingStatusLine(new Date(now + 5 * 3_600_000).toISOString(), FALLBACK_TERMS, now)).toMatch(/^Driver search starts at /)
    expect(upcomingStatusLine(new Date(now + 5 * 60_000).toISOString(), FALLBACK_TERMS, now)).toBe('Finding your driver')
  })
})
