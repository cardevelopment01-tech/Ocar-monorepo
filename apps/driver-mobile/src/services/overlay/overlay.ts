// The floating Ocar icon and "bring Ocar to the front", over the native `OcarOverlay` module (apps/driver-mobile/modules/ocar-overlay).
// Pure logic: the native module is passed in, so this file has no React Native imports and is unit tested. Every call is safe on a
// build that does not have the module (an older binary, iOS, web): it reports "not available" instead of throwing.

export interface NativeOverlay {
  hasPermission(): boolean
  openPermissionSettings(): void
  showIcon(): boolean
  hideIcon(): void
  isIconShowing(): boolean
  pulseIcon(): void
  bringToFront(): boolean
}

export interface Overlay {
  /** The build has the native module at all (Android build that includes it). */
  readonly available: boolean
  hasPermission(): boolean
  openPermissionSettings(): void
  /** True when the icon is (about to be) on screen; false when unavailable or the permission is missing. */
  showIcon(): boolean
  hideIcon(): void
  isIconShowing(): boolean
  pulseIcon(): void
  /** True when Android accepted the launch. A refusal is expected on some phones and is not an error. */
  bringToFront(): boolean
}

const guard = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

export function createOverlay(native: NativeOverlay | null | undefined): Overlay {
  if (!native) {
    return {
      available: false,
      hasPermission: () => false,
      openPermissionSettings: () => {},
      showIcon: () => false,
      hideIcon: () => {},
      isIconShowing: () => false,
      pulseIcon: () => {},
      bringToFront: () => false,
    }
  }
  return {
    available: true,
    hasPermission: () => guard(() => native.hasPermission(), false),
    openPermissionSettings: () => guard(() => native.openPermissionSettings(), undefined),
    showIcon: () => guard(() => native.showIcon(), false),
    hideIcon: () => guard(() => native.hideIcon(), undefined),
    isIconShowing: () => guard(() => native.isIconShowing(), false),
    pulseIcon: () => guard(() => native.pulseIcon(), undefined),
    bringToFront: () => guard(() => native.bringToFront(), false),
  }
}
