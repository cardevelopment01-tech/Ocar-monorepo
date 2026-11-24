import { describe, it, expect } from 'vitest'
import { isStale, STALE_AFTER_MS } from '../driver-staleness'

const now = Date.parse('2026-11-25T00:00:00Z')

describe('isStale', () => {
  it('fresh fix is live', () => expect(isStale('2026-11-24T23:59:50Z', now)).toBe(false))
  it('exactly at the limit is still live', () => expect(isStale(new Date(now - STALE_AFTER_MS).toISOString(), now)).toBe(false))
  it('older than the limit is stale', () => expect(isStale('2026-11-24T23:50:00Z', now)).toBe(true))
  it('a missing or unparseable time is stale', () => {
    expect(isStale(null, now)).toBe(true)
    expect(isStale('nope', now)).toBe(true)
  })
})
