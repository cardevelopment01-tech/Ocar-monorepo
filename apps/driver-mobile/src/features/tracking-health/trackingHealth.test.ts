import { describe, expect, it } from 'vitest'
import { DEGRADED_AFTER_MS } from '@/services/location/locationPolicy'
import { assessTracking, ISSUE_COPY, NEEDS_CONFIRMATION, NO_SIGNAL_AFTER_MS, START_GRACE_MS, type TrackingSnapshot } from './trackingHealth'

const healthy: TrackingSnapshot = {
  foregroundGranted: true, backgroundGranted: true, servicesEnabled: true, taskRunning: true, lastFixAgeMs: 5_000, sinceOnlineMs: 600_000,
}

describe('assessTracking', () => {
  it('is fine when everything is on and a fix is recent', () => {
    expect(assessTracking(healthy)).toBeNull()
  })
  it('names a missing permission first, since it explains everything after it', () => {
    expect(assessTracking({ ...healthy, foregroundGranted: false, backgroundGranted: false, servicesEnabled: false, taskRunning: false })).toBe('permission')
  })
  it('then the missing "all the time" permission', () => {
    expect(assessTracking({ ...healthy, backgroundGranted: false, servicesEnabled: false })).toBe('background_permission')
  })
  it("then the phone's Location switch", () => {
    expect(assessTracking({ ...healthy, servicesEnabled: false, taskRunning: false })).toBe('services_off')
  })
  it('then the tracking task not running', () => {
    expect(assessTracking({ ...healthy, taskRunning: false })).toBe('not_running')
  })
  it('does not call a still-starting service "not running" inside the start grace', () => {
    expect(assessTracking({ ...healthy, taskRunning: false, lastFixAgeMs: null, sinceOnlineMs: START_GRACE_MS - 1 })).toBeNull()
    expect(assessTracking({ ...healthy, taskRunning: false, lastFixAgeMs: null, sinceOnlineMs: START_GRACE_MS })).toBe('not_running')
  })
  it('waits longer than the rough-fix fallback, so a garage with rough fixes is not flagged between them', () => {
    expect(NO_SIGNAL_AFTER_MS).toBeGreaterThan(DEGRADED_AFTER_MS)
  })
  it('a quiet GPS is only reported after the grace period', () => {
    expect(assessTracking({ ...healthy, lastFixAgeMs: NO_SIGNAL_AFTER_MS - 1 })).toBeNull()
    expect(assessTracking({ ...healthy, lastFixAgeMs: NO_SIGNAL_AFTER_MS })).toBe('no_signal')
  })
  it('with no fix yet, counts the quiet from when the driver went online', () => {
    expect(assessTracking({ ...healthy, lastFixAgeMs: null, sinceOnlineMs: 30_000 })).toBeNull()
    expect(assessTracking({ ...healthy, lastFixAgeMs: null, sinceOnlineMs: NO_SIGNAL_AFTER_MS })).toBe('no_signal')
  })
})

describe('issue copy', () => {
  it('only the two soft issues wait for a second check', () => {
    expect([...NEEDS_CONFIRMATION].sort()).toEqual(['no_signal', 'not_running'])
  })
  it('every fixable issue offers exactly one action, and the GPS wait offers none', () => {
    for (const [issue, c] of Object.entries(ISSUE_COPY)) {
      if (issue === 'no_signal') expect(c.action).toBeUndefined()
      else { expect(c.action).toBeDefined(); expect(c.actionLabel).toBeTruthy() }
    }
  })
  it('stays short enough to read at a glance on a phone', () => {
    for (const c of Object.values(ISSUE_COPY)) { expect(c.title.length).toBeLessThanOrEqual(34); expect(c.message.length).toBeLessThanOrEqual(130) }
  })
})
