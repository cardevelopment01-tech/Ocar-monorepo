import { describe, it, expect, vi } from 'vitest'
import { createOverlay, type NativeOverlay } from './overlay'

const fakeNative = (over: Partial<NativeOverlay> = {}): NativeOverlay => ({
  hasPermission: vi.fn(() => true),
  openPermissionSettings: vi.fn(),
  showIcon: vi.fn(() => true),
  hideIcon: vi.fn(),
  isIconShowing: vi.fn(() => true),
  pulseIcon: vi.fn(),
  setAlert: vi.fn(),
  bringToFront: vi.fn(() => true),
  ...over,
})

describe('createOverlay', () => {
  it('without the native module every call is a safe "not available" (old binary, iOS, web)', () => {
    const o = createOverlay(null)
    expect(o.available).toBe(false)
    expect(o.hasPermission()).toBe(false)
    expect(o.showIcon()).toBe(false)
    expect(o.bringToFront()).toBe(false)
    expect(o.isIconShowing()).toBe(false)
    expect(() => { o.hideIcon(); o.pulseIcon(); o.openPermissionSettings() }).not.toThrow()
  })

  it('delegates to the native module when it exists', () => {
    const native = fakeNative()
    const o = createOverlay(native)
    expect(o.available).toBe(true)
    expect(o.showIcon()).toBe(true)
    expect(o.bringToFront()).toBe(true)
    o.hideIcon(); o.pulseIcon(); o.openPermissionSettings()
    expect(native.hideIcon).toHaveBeenCalledTimes(1)
    expect(native.pulseIcon).toHaveBeenCalledTimes(1)
    expect(native.openPermissionSettings).toHaveBeenCalledTimes(1)
  })

  it('setAlert reaches the native icon, and is a no-op on a binary without it', () => {
    const native = fakeNative()
    createOverlay(native).setAlert(true)
    expect(native.setAlert).toHaveBeenCalledWith(true)
    const { setAlert: _omit, ...older } = fakeNative()
    expect(() => createOverlay(older).setAlert(true)).not.toThrow()
    expect(() => createOverlay(null).setAlert(false)).not.toThrow()
  })

  it('reports false when the permission is missing, never throws', () => {
    const o = createOverlay(fakeNative({ hasPermission: vi.fn(() => false), showIcon: vi.fn(() => false) }))
    expect(o.hasPermission()).toBe(false)
    expect(o.showIcon()).toBe(false)
  })

  it('a native error becomes a safe fallback, never an exception into the app', () => {
    const boom = () => { throw new Error('native failure') }
    const o = createOverlay(fakeNative({ hasPermission: boom, showIcon: boom, hideIcon: boom, bringToFront: boom, isIconShowing: boom, pulseIcon: boom, openPermissionSettings: boom }))
    expect(o.hasPermission()).toBe(false)
    expect(o.showIcon()).toBe(false)
    expect(o.bringToFront()).toBe(false)
    expect(o.isIconShowing()).toBe(false)
    expect(() => { o.hideIcon(); o.pulseIcon(); o.openPermissionSettings() }).not.toThrow()
  })
})
