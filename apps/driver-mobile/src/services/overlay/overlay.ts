// The floating Ocar icon and "bring Ocar to the front", over the native `OcarOverlay` module (apps/driver-mobile/modules/ocar-overlay).
// Pure logic: the native module is passed in, so this file has no React Native imports and is unit tested. Every call is safe on a
// build that does not have the module (an older binary, iOS, web): it reports "not available" instead of throwing.

export interface NativeOverlay {
  hasPermission(): boolean
  openPermissionSettings(): void
  showIcon(): boolean
  hideIcon(): void
  isIconShowing(): boolean
  /** Optional: a binary built before the red-dot change does not have it. */
  setAlert?(on: boolean): void
  /** Optional, same reason: removes a delivered notification by tag. */
  dismissNotification?(tag: string): void
  bringToFront(): boolean
  /** Optional: a binary built before drag-to-close does not have these. */
  setDismissEnabled?(on: boolean): void
  exitApp?(): void
  addListener?(event: 'onIconDismissed', listener: () => void): { remove(): void }
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
  /** A request is waiting (true) or no longer is (false): the icon wears a pulsing red dot until cleared. */
  setAlert(on: boolean): void
  /** Removes the ride request's push notification (tag `ride-<rideId>`, set by the server) so it stops ringing once Ocar's own card takes over. */
  dismissRideNotification(rideId: string): void
  /** True when Android accepted the launch. A refusal is expected on some phones and is not an error. */
  bringToFront(): boolean
  /** The X shown while the icon is dragged: on, or off (it is off during a ride, when closing the app would stop the ride's tracking). */
  setDismissEnabled(on: boolean): void
  /** The driver dropped the icon on the X. Returns how to stop listening. Never fires on a binary without drag-to-close. */
  onDismissed(listener: () => void): () => void
  /** Stops the location service and ends the app's process. */
  exitApp(): void
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
      setAlert: () => {},
      dismissRideNotification: () => {},
      bringToFront: () => false,
      setDismissEnabled: () => {},
      onDismissed: () => () => {},
      exitApp: () => {},
    }
  }
  return {
    available: true,
    hasPermission: () => guard(() => native.hasPermission(), false),
    openPermissionSettings: () => guard(() => native.openPermissionSettings(), undefined),
    showIcon: () => guard(() => native.showIcon(), false),
    hideIcon: () => guard(() => native.hideIcon(), undefined),
    isIconShowing: () => guard(() => native.isIconShowing(), false),
    setAlert: (on) => guard(() => native.setAlert?.(on), undefined),
    dismissRideNotification: (rideId) => guard(() => native.dismissNotification?.(`ride-${rideId}`), undefined),
    bringToFront: () => guard(() => native.bringToFront(), false),
    setDismissEnabled: (on) => guard(() => native.setDismissEnabled?.(on), undefined),
    onDismissed: (listener) => {
      const sub = guard(() => native.addListener?.('onIconDismissed', listener), undefined)
      return () => guard(() => sub?.remove(), undefined)
    },
    exitApp: () => guard(() => native.exitApp?.(), undefined),
  }
}
