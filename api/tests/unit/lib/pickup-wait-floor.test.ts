import { describe, it, expect } from 'vitest'
import { pickupWaitFloor } from '@/lib/pickup-wait-floor'

describe('pickupWaitFloor', () => {
  it('is nothing for an ordinary ride, so the wait clock is called exactly as before', () => {
    expect(pickupWaitFloor({})).toEqual([])
    expect(pickupWaitFloor({ scheduled_for: null })).toEqual([])
  })
  it("is the booked pickup time for an advance ride", () => {
    expect(pickupWaitFloor({ scheduled_for: '2026-11-26T13:00:00.000Z' })).toEqual([new Date('2026-11-26T13:00:00.000Z')])
    const d = new Date('2026-11-26T13:00:00.000Z')
    expect(pickupWaitFloor({ scheduled_for: d })).toEqual([d])
  })
  it('ignores a value that is not a date rather than poisoning the query', () => {
    expect(pickupWaitFloor({ scheduled_for: 'not a date' })).toEqual([])
  })
})
