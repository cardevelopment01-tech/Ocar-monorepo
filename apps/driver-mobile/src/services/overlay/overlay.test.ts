import { describe, it, expect, vi } from 'vitest'
import { createOverlay, type NativeOverlay } from './overlay'

const fakeNative = (over: Partial<NativeOverlay> = {}): NativeOverlay => ({
  hasPermission: vi.fn(() => true),
  openPermissionSettings: vi.fn(),
  showIcon: vi.fn(() => true),
  hideIcon: vi.fn(),
  isIconShowing: vi.fn(() => true),
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
    expect(() => { o.hideIcon(); o.setAlert(true); o.openPermissionSettings() }).not.toThrow()
  })

  it('delegates to the native module when it exists', () => {
    const native = fakeNative()
    const o = createOverlay(native)
    expect(o.available).toBe(true)
    expect(o.showIcon()).toBe(true)
    expect(o.bringToFront()).toBe(true)
    o.hideIcon(); o.setAlert(true); o.openPermissionSettings()
    expect(native.hideIcon).toHaveBeenCalledTimes(1)
    expect(native.setAlert).toHaveBeenCalledWith(true)
    expect(native.openPermissionSettings).toHaveBeenCalledTimes(1)
  })

  it('setAlert reaches the native icon, and is a no-op on a binary without it', () => {
    const native = fakeNative()
    createOverlay(native).setAlert(true)
    expect(native.setAlert).toHaveBeenCalledWith(true)
    const older = fakeNative()
    delete older.setAlert // a binary built before the red-dot change has no such function
    expect(() => createOverlay(older).setAlert(true)).not.toThrow()
    expect(() => createOverlay(null).setAlert(false)).not.toThrow()
  })

  it('dismissRideNotification cancels the notification tagged ride-<id>, and is a no-op on a binary without it', () => {
    const dismissNotification = vi.fn()
    createOverlay(fakeNative({ dismissNotification })).dismissRideNotification('42')
    expect(dismissNotification).toHaveBeenCalledWith('ride-42')
    expect(() => createOverlay(fakeNative()).dismissRideNotification('42')).not.toThrow()
    expect(() => createOverlay(null).dismissRideNotification('42')).not.toThrow()
    const boom = () => { throw new Error('native failure') }
    expect(() => createOverlay(fakeNative({ dismissNotification: boom })).dismissRideNotification('42')).not.toThrow()
  })

  it('reports false when the permission is missing, never throws', () => {
    const o = createOverlay(fakeNative({ hasPermission: vi.fn(() => false), showIcon: vi.fn(() => false) }))
    expect(o.hasPermission()).toBe(false)
    expect(o.showIcon()).toBe(false)
  })

  it('a native error becomes a safe fallback, never an exception into the app', () => {
    const boom = () => { throw new Error('native failure') }
    const o = createOverlay(fakeNative({ hasPermission: boom, showIcon: boom, hideIcon: boom, bringToFront: boom, isIconShowing: boom, setAlert: boom, openPermissionSettings: boom }))
    expect(() => o.setAlert(true)).not.toThrow()
    expect(o.hasPermission()).toBe(false)
    expect(o.showIcon()).toBe(false)
    expect(o.bringToFront()).toBe(false)
    expect(o.isIconShowing()).toBe(false)
    expect(() => { o.hideIcon(); o.setAlert(true); o.openPermissionSettings() }).not.toThrow()
  })
})
