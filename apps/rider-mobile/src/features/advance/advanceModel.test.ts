import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cancelCopy, FALLBACK_TERMS, minutesText, pickupBounds, pickupProblem, rescheduleErrorMessage, searchStartsAt, termsLines, upcomingStatusLine, type AdvanceTerms } from './advanceModel'

const originalTz = process.env['TZ']
beforeAll(() => { process.env['TZ'] = 'Asia/Kolkata' })
afterAll(() => { if (originalTz === undefined) delete process.env['TZ']; else process.env['TZ'] = originalTz })

const withFee: AdvanceTerms = { ...FALLBACK_TERMS, lateCancel: { windowMin: 60, mode: 'percent', percent: 10, cap: 100, flat: 50 } }
const NOW = new Date('2026-11-23T04:30:00Z').getTime() // 10:00 am in India
const minutesFromNow = (m: number) => new Date(NOW + m * 60_000)

describe('minutesText', () => {
  it.each([[1, '1 minute'], [15, '15 minutes'], [60, '1 hour'], [90, '1 hour 30 minutes'], [120, '2 hours']])('%i -> %s', (m, out) => expect(minutesText(m)).toBe(out))
})

describe('searchStartsAt', () => {
  it('is the pickup minus the lead time', () => {
    expect(searchStartsAt('2026-11-23T13:00:00Z', 15).toISOString()).toBe('2026-11-23T12:45:00.000Z')
  })
})

describe('termsLines', () => {
  it('without a chosen time, says the lead time and that changing is free', () => {
    const l = termsLines(FALLBACK_TERMS)
    expect(l[0]).toBe('We start finding your driver 15 minutes before pickup. You can change the time for free until then.')
  })
  it('with a chosen time, gives the actual moment the search starts, in the rider\'s own time', () => {
    expect(termsLines(FALLBACK_TERMS, '2026-11-23T13:00:00Z')[0]).toContain('6:15 pm')
  })
  it('always says the fare can move a little (we re-quote at dispatch)', () => {
    expect(termsLines(FALLBACK_TERMS).join(' ')).toContain('may differ a little')
  })
  it('mentions no fee while the policy is off', () => {
    expect(termsLines(FALLBACK_TERMS).join(' ')).not.toContain('costs')
  })
  it('states the fee rule up front when an admin has turned it on', () => {
    const line = termsLines(withFee).find(x => x.includes('costs'))!
    expect(line).toBe('Cancelling within 1 hour of pickup, after a driver has accepted, costs 10% of the fare, up to ₹100. Earlier is free.')
  })
  it('states a flat fee plainly', () => {
    const flat: AdvanceTerms = { ...FALLBACK_TERMS, lateCancel: { windowMin: 90, mode: 'flat', percent: 10, cap: 100, flat: 75 } }
    expect(termsLines(flat).join(' ')).toContain('within 1 hour 30 minutes of pickup, after a driver has accepted, costs ₹75')
  })
})

describe('pickupProblem / pickupBounds', () => {
  it('refuses under the minimum, over the maximum, and nonsense', () => {
    expect(pickupProblem(minutesFromNow(30), FALLBACK_TERMS, NOW)).toBe('Pick a time at least 1 hour from now.')
    expect(pickupProblem(minutesFromNow(8 * 24 * 60), FALLBACK_TERMS, NOW)).toBe('You can book up to 7 days ahead.')
    expect(pickupProblem(new Date('x'), FALLBACK_TERMS, NOW)).toBe('Pick a date and time.')
  })
  it('accepts a time inside the window, including exactly at the minimum', () => {
    expect(pickupProblem(minutesFromNow(180), FALLBACK_TERMS, NOW)).toBeNull()
    expect(pickupProblem(minutesFromNow(60), FALLBACK_TERMS, NOW)).toBeNull()
  })
  it('bounds the picker a minute inside the server limit so a pick at the edge is not refused later', () => {
    const b = pickupBounds(FALLBACK_TERMS, NOW)
    expect(b.min.getTime()).toBe(NOW + 61 * 60_000)
    expect(b.max.getTime()).toBe(NOW + 7 * 86_400_000)
    expect(pickupProblem(b.min, FALLBACK_TERMS, NOW)).toBeNull()
  })
})

describe('cancelCopy', () => {
  const free = { canCancel: true, status: 'scheduled', fee: 0, reason: 'none' as const, windowMin: null }
  it('says a fee in rupees on the headline and the button, and why', () => {
    const c = cancelCopy({ ...free, fee: 100, reason: 'late_cancel', freeUntil: '2026-11-23T04:00:00Z', windowMin: 60 })
    expect(c.title).toBe('Cancelling costs ₹100')
    expect(c.confirm).toBe('Cancel and pay ₹100')
    expect(c.body).toContain('A driver has accepted and your pickup is within 1 hour')
    expect(c.fee).toBe(100)
  })
  it('explains an arrived-driver fee differently', () => {
    expect(cancelCopy({ ...free, fee: 50, reason: 'arrived', freeUntil: null }).body).toContain('driver has arrived')
  })
  it('says when the free period ends while it is still free, and just "not charged" after', () => {
    const later = new Date(Date.now() + 3 * 3_600_000).toISOString()
    expect(cancelCopy({ ...free, freeUntil: later }).body).toMatch(/^It is free to cancel until \d/)
    expect(cancelCopy({ ...free, freeUntil: null }).body).toBe('You will not be charged.')
    expect(cancelCopy({ ...free, freeUntil: null }).confirm).toBe('Cancel ride')
  })
})

describe('rescheduleErrorMessage', () => {
  it('translates the API codes, and falls back for anything else', () => {
    expect(rescheduleErrorMessage('RESCHEDULE_LIMIT', 'x')).toContain('used all the time changes')
    expect(rescheduleErrorMessage('NOT_RESCHEDULABLE', 'x')).toContain('already started looking')
    expect(rescheduleErrorMessage(undefined, 'Could not change the time.')).toBe('Could not change the time.')
  })
})

describe('upcomingStatusLine', () => {
  it('says when the search starts, then that we are finding a driver', () => {
    expect(upcomingStatusLine(minutesFromNow(300).toISOString(), FALLBACK_TERMS, NOW)).toBe('Driver search starts at 2:45 pm')
    expect(upcomingStatusLine(minutesFromNow(10).toISOString(), FALLBACK_TERMS, NOW)).toBe('Finding your driver')
  })
})
