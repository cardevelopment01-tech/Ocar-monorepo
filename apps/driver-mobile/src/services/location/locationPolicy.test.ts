import { describe, expect, it } from 'vitest'
import {
  ACTIVE_RIDE_INTERVAL_MS,
  IDLE_INTERVAL_MS,
  MAX_ACCURACY_M,
  intervalForRideState,
  isAccurateEnough,
} from './locationPolicy'

describe('isAccurateEnough', () => {
  it('accepts a fix at exactly the threshold', () => {
    expect(isAccurateEnough(MAX_ACCURACY_M)).toBe(true)
  })

  it('accepts a fix well within the threshold', () => {
    expect(isAccurateEnough(10)).toBe(true)
  })

  it('rejects a fix worse than the threshold', () => {
    expect(isAccurateEnough(MAX_ACCURACY_M + 1)).toBe(false)
  })

  it('accepts a fix with no accuracy figure at all -- some platforms omit it', () => {
    expect(isAccurateEnough(null)).toBe(true)
    expect(isAccurateEnough(undefined)).toBe(true)
  })
})

describe('intervalForRideState', () => {
  it('polls tightly (3s) during an active ride', () => {
    expect(intervalForRideState(true)).toBe(ACTIVE_RIDE_INTERVAL_MS)
  })

  it('polls loosely (30s) while idle-online with no active ride', () => {
    expect(intervalForRideState(false)).toBe(IDLE_INTERVAL_MS)
  })

  it('the active-ride interval is strictly tighter than the idle interval', () => {
    expect(ACTIVE_RIDE_INTERVAL_MS).toBeLessThan(IDLE_INTERVAL_MS)
  })
})
