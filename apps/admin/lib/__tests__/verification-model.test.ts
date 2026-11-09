import { describe, it, expect } from 'vitest'
import { bandFor, reasonText, reviewKey, nextSelection, budgetTone, similarityText, kindLabel, challengeReasonText, waitingText } from '../verification-model'

describe('bandFor', () => {
  it('always has a text label and maps tones', () => {
    expect(bandFor('fail')).toEqual({ label: 'FAIL', tone: 'danger' })
    expect(bandFor('review')).toEqual({ label: 'REVIEW', tone: 'warning' })
    expect(bandFor('pass').tone).toBe('success')
    expect(bandFor('error').tone).toBe('muted')
    expect(bandFor(null).label).toBe('N/A')
  })
})

describe('reasonText', () => {
  it('speaks plainly and never leaks a raw code for known reasons', () => {
    expect(reasonText('LOW_SIMILARITY')).toMatch(/doesn't look like/)
    expect(reasonText('PROVIDER_ERROR')).toMatch(/person should look/)
  })
  it('falls back to a readable form for unknown codes and empty for null', () => {
    expect(reasonText('SOME_NEW_CODE')).toBe('some new code')
    expect(reasonText(null)).toBe('')
  })
})

describe('reviewKey', () => {
  it('maps J K O M', () => {
    expect(reviewKey({ key: 'j' })).toBe('next')
    expect(reviewKey({ key: 'K' })).toBe('prev')
    expect(reviewKey({ key: 'o' })).toBe('ok')
    expect(reviewKey({ key: 'm' })).toBe('mismatch')
    expect(reviewKey({ key: 'x' })).toBeNull()
  })
  it('ignores typing in fields and modified keys', () => {
    expect(reviewKey({ key: 'o', target: { tagName: 'TEXTAREA' } })).toBeNull()
    expect(reviewKey({ key: 'm', target: { tagName: 'input' } })).toBeNull()
    expect(reviewKey({ key: 'o', ctrlKey: true })).toBeNull()
    expect(reviewKey({ key: 'j', metaKey: true })).toBeNull()
  })
})

describe('nextSelection', () => {
  it('opens the case that takes the resolved one\'s place', () => {
    expect(nextSelection(['a', 'b', 'c'], 'a')).toBe('b')
    expect(nextSelection(['a', 'b', 'c'], 'b')).toBe('c')
  })
  it('falls back to the previous one when the last is resolved, and null when empty', () => {
    expect(nextSelection(['a', 'b', 'c'], 'c')).toBe('b')
    expect(nextSelection(['a'], 'a')).toBeNull()
  })
  it('opens the first when the resolved id is no longer in the list', () => {
    expect(nextSelection(['a', 'b'], 'zz')).toBe('a')
  })
})

describe('small formatters', () => {
  it('formats', () => {
    expect(similarityText(41.4)).toBe('41%')
    expect(similarityText(null)).toBe('-')
    expect(kindLabel('daily_plate')).toBe('Plate')
    expect(kindLabel('spot_selfie')).toBe('Selfie')
    expect(budgetTone(31, 30)).toBe('over')
    expect(budgetTone(30, 30)).toBe('ok')
  })
})

describe('open check helpers', () => {
  it('words the reason for the admin, never the driver', () => {
    expect(challengeReasonText('long_ride')).toBe('After a long ride')
    expect(challengeReasonText('rides')).toBe('After a few rides')
    expect(challengeReasonText('admin')).toBe('Set by an admin')
  })
  it('shows how long a driver has been waiting', () => {
    const now = Date.parse('2026-11-07T12:00:00Z')
    expect(waitingText('2026-11-07T11:30:00Z', now)).toBe('30 min')
    expect(waitingText('2026-11-07T09:00:00Z', now)).toBe('3 h')
    expect(waitingText('2026-11-04T12:00:00Z', now)).toBe('3 d')
    expect(waitingText('2026-11-07T13:00:00Z', now)).toBe('0 min')
  })
})
