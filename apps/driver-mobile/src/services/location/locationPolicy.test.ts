import { describe, expect, it } from 'vitest'
import {
  ACTIVE_RIDE_INTERVAL_MS,
  IDLE_INTERVAL_MS,
  DEGRADED_AFTER_MS,
  MAX_ACCURACY_M,
  shouldSendLivePosition,
  intervalForRideState,
  isAccurateEnough,
  trackingProfileForRideState,
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

describe('trackingProfileForRideState', () => {
  it('uses High accuracy at 3s/5m while a ride is active', () => {
    expect(trackingProfileForRideState(true)).toEqual({ intervalMs: 3_000, distanceMeters: 5, highAccuracy: true })
  })
  it('uses High accuracy at 30s while idle-online (Balanced gave ~100 m fixes that failed the 80 m check)', () => {
    expect(trackingProfileForRideState(false)).toEqual({ intervalMs: 30_000, distanceMeters: 0, highAccuracy: true })
  })
})

describe('shouldSendLivePosition', () => {
  it('always sends an accurate fix, and one with no accuracy figure', () => {
    expect(shouldSendLivePosition(12, 0, false)).toBe(true)
    expect(shouldSendLivePosition(80, 0, false)).toBe(true)
    expect(shouldSendLivePosition(null, 0, false)).toBe(true)
  })
  it('holds a rough fix back while a good one went out recently', () => {
    expect(shouldSendLivePosition(150, 30_000, false)).toBe(false)
  })
  it('sends one rough fix once nothing good has gone out for 2 minutes', () => {
    expect(shouldSendLivePosition(150, DEGRADED_AFTER_MS, false)).toBe(true)
    expect(shouldSendLivePosition(300, DEGRADED_AFTER_MS, false)).toBe(true)
  })
  it('never sends a hopeless fix (worse than 300 m), however long it has been', () => {
    expect(shouldSendLivePosition(301, 10 * 60_000, false)).toBe(false)
  })
  it('never sends a rough fix during a ride: it would be stored as a billing breadcrumb', () => {
    expect(shouldSendLivePosition(150, 10 * 60_000, true)).toBe(false)
    expect(shouldSendLivePosition(20, 0, true)).toBe(true)
  })
})
