import { describe, expect, it } from 'vitest'
import { computeRemainingSeconds } from './countdown'

describe('computeRemainingSeconds', () => {
  it('returns the full timeout at the moment of receipt', () => {
    const now = 1_000_000
    expect(computeRemainingSeconds(20, now, now)).toBe(20)
  })

  it('counts down as local time elapses', () => {
    const receivedAt = 1_000_000
    expect(computeRemainingSeconds(20, receivedAt, receivedAt + 5000)).toBe(15)
  })

  it('never goes negative once the timeout has fully elapsed', () => {
    const receivedAt = 1_000_000
    expect(computeRemainingSeconds(20, receivedAt, receivedAt + 30_000)).toBe(0)
  })

  it('is unaffected by device clock skew, since both timestamps share the same clock', () => {
    // A device clock that jumped forward or backward between receipt and now
    // still produces the correct elapsed delta, because both timestamps come
    // from the same clock -- this is exactly the bug the Eng review caught in
    // comparing a server expiresAt against a local Date.now() directly.
    const receivedAt = 5_000_000
    const skewedNow = receivedAt + 3000
    expect(computeRemainingSeconds(10, receivedAt, skewedNow)).toBe(7)
  })
})
