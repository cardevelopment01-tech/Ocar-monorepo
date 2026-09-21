import { describe, expect, it } from 'vitest'
import { canTapGoOnline } from './sessionRestoreGuard'

describe('canTapGoOnline', () => {
  it('is false while the session check is still in flight', () => {
    expect(canTapGoOnline('checking', false, false)).toBe(false)
  })

  it('is true once the check resolves and the driver is offline', () => {
    expect(canTapGoOnline('ready', false, false)).toBe(true)
  })

  it('is false if the session check failed', () => {
    expect(canTapGoOnline('failed', false, false)).toBe(false)
  })

  it('is false while already online', () => {
    expect(canTapGoOnline('ready', true, false)).toBe(false)
  })

  it('is false while a go-online request is in flight (double-tap guard)', () => {
    expect(canTapGoOnline('ready', false, true)).toBe(false)
  })
})
