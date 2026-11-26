import { describe, expect, it, vi } from 'vitest'
import { askThenFallback, DIALOG_NOT_SHOWN_MS, missingRequired, SETUP_SNOOZE_MS, shouldShowSetup, statusFromNotificationPermission, type PermissionRowModel } from './permissionRules'

const row = (over: Partial<PermissionRowModel>): PermissionRowModel => ({ key: 'k', title: 't', reason: 'r', status: 'ask', required: true, actionLabel: 'Allow', ...over })

describe('shouldShowSetup', () => {
  it('shows when a required permission is missing and nothing was snoozed', () => {
    expect(shouldShowSetup([row({})], null, 1000)).toBe(true)
  })
  it('stays away when every required permission is granted, even with optional ones missing', () => {
    expect(shouldShowSetup([row({ status: 'granted' }), row({ key: 'o', required: false, status: 'ask' })], null, 1000)).toBe(false)
  })
  it('a blocked required permission still counts as missing', () => {
    expect(shouldShowSetup([row({ status: 'blocked' })], null, 1000)).toBe(true)
  })
  it('"Not now" hides it for a day, then it comes back', () => {
    const t0 = 5_000_000
    expect(shouldShowSetup([row({})], t0, t0 + SETUP_SNOOZE_MS - 1)).toBe(false)
    expect(shouldShowSetup([row({})], t0, t0 + SETUP_SNOOZE_MS)).toBe(true)
  })
})

describe('missingRequired / statusFromNotificationPermission', () => {
  it('lists only required, ungranted rows', () => {
    const rows = [row({ key: 'a', status: 'granted' }), row({ key: 'b' }), row({ key: 'c', required: false })]
    expect(missingRequired(rows).map((r) => r.key)).toEqual(['b'])
  })
  it('maps the system answer: granted, can still ask, or settings only', () => {
    expect(statusFromNotificationPermission({ granted: true, canAskAgain: true, status: 'granted' })).toBe('granted')
    expect(statusFromNotificationPermission({ granted: false, canAskAgain: true, status: 'undetermined' })).toBe('ask')
    expect(statusFromNotificationPermission({ granted: false, canAskAgain: false, status: 'denied' })).toBe('blocked')
  })
  it("after one Don't allow the dialog can still be shown, so the row still says Allow", () => {
    expect(statusFromNotificationPermission({ granted: false, canAskAgain: true, status: 'denied' })).toBe('ask')
  })
  it('on Android 12 and older there is no dialog, so notifications that are off can only be fixed in Settings', () => {
    expect(statusFromNotificationPermission({ granted: false, canAskAgain: true, status: 'undetermined' }, 31)).toBe('blocked')
    expect(statusFromNotificationPermission({ granted: true, canAskAgain: true, status: 'granted' }, 31)).toBe('granted')
    expect(statusFromNotificationPermission({ granted: false, canAskAgain: true, status: 'undetermined' }, 34)).toBe('ask')
  })
})

describe('askThenFallback', () => {
  const clock = (...times: number[]) => { let i = 0; return () => times[Math.min(i++, times.length - 1)]! }
  it('opens settings when the request came back not granted at once (no dialog was shown)', async () => {
    const open = vi.fn(async () => {})
    await askThenFallback(async () => false, open, clock(0, DIALOG_NOT_SHOWN_MS - 1))
    expect(open).toHaveBeenCalledTimes(1)
  })
  it('does not open settings when the person answered a real dialog and said no', async () => {
    const open = vi.fn(async () => {})
    await askThenFallback(async () => false, open, clock(0, DIALOG_NOT_SHOWN_MS + 1))
    expect(open).not.toHaveBeenCalled()
  })
  it('does not open settings when it was granted', async () => {
    const open = vi.fn(async () => {})
    await askThenFallback(async () => true, open, clock(0, 5))
    expect(open).not.toHaveBeenCalled()
  })
})
