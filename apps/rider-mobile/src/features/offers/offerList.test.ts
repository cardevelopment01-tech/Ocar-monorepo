import { describe, it, expect } from 'vitest'
import { expiryText, homeOffer } from './offerList'

// Value: protects=offers read as plain dates (no countdowns), an ended offer says so, and home shows one real offer or none;
// fails_when=a countdown or a placeholder card sneaks in; why_new=PR4 My Offers / home; seam=none; no_claim=layout.
const now = new Date('2026-12-01T06:00:00Z')

describe('expiryText', () => {
  it('writes a plain date in India time, with no time left or urgency', () => {
    expect(expiryText('2026-12-12T18:29:00Z', now)).toBe('Ends 12 Dec')
    expect(expiryText('2026-12-12T18:31:00Z', now)).toBe('Ends 13 Dec') // after midnight IST
  })
  it('says Ended for a past end, and nothing when there is no end or a bad date', () => {
    expect(expiryText('2026-11-30T00:00:00Z', now)).toBe('Ended')
    expect(expiryText(null, now)).toBeNull()
    expect(expiryText('not a date', now)).toBeNull()
  })
})

describe('homeOffer', () => {
  it('is the first offer, or null so home shows nothing', () => {
    const o = { id: '1', name: 'a', kind: 'auto', summary: '10% off', endsAt: null }
    expect(homeOffer([o, { ...o, id: '2' }])).toBe(o)
    expect(homeOffer([])).toBeNull()
  })
})
