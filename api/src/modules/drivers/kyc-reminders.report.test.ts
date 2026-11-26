import { describe, expect, it } from 'vitest'
import { driverState, sendResult } from './kyc-reminders.report'

describe('sendResult', () => {
  it('reached when FCM accepted it for at least one device', () => {
    expect(sendResult({ successCount: 1, failureCount: 0, invalidTokens: 0 }, null)).toBe('reached')
  })
  it('no device when the push worker recorded nothing at all (no token on file)', () => {
    expect(sendResult(null, null)).toBe('no_device')
  })
  it('blocked when every token was refused as invalid', () => {
    expect(sendResult({ successCount: 0, failureCount: 1, invalidTokens: 1 }, null)).toBe('blocked')
  })
  it('a problem when FCM was unavailable or the push expired before sending', () => {
    expect(sendResult({ successCount: 0, failureCount: 0, invalidTokens: 0 }, 'fcm_unavailable')).toBe('problem')
    expect(sendResult(null, 'expired_before_send')).toBe('problem')
  })
})

describe('driverState', () => {
  const now = new Date('2026-12-10T06:00:00Z')
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000)
  it('came back when the driver moved forward after the last reminder', () => {
    expect(driverState({ lastSentAt: ago(3), updatedAt: ago(1), now, pauseDay: 10 })).toBe('came_back')
  })
  it('paused once past the pause day, reminded in between, not due before any send', () => {
    expect(driverState({ lastSentAt: ago(5), updatedAt: ago(11), now, pauseDay: 10 })).toBe('paused')
    expect(driverState({ lastSentAt: ago(1), updatedAt: ago(5), now, pauseDay: 10 })).toBe('reminded')
    expect(driverState({ lastSentAt: null, updatedAt: ago(2), now, pauseDay: 10 })).toBe('not_due')
  })
})
