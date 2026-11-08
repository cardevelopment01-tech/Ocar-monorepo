// When the floating icon shows and when Ocar may open itself. Pure functions, no React Native imports (unit tested).
// Decisions live in docs/superpowers/plans/2026-11-05-driver-app-closed-ride-alert-overlay.md (sections 1c, 4b, 5b):
// the client (the phone) is the final gate and every unknown fails closed.

export type AppStateName = 'active' | 'background' | 'inactive' | 'unknown' | 'extension'

/**
 * Ocar opens itself for a request only at or below this speed. Set high on purpose (owner's call, 2026-11-08): drivers get most
 * requests on the move and Uber/Ola-style apps show them anyway, so this only stops the screen jumping up at highway speed.
 */
export const AUTO_OPEN_MAX_SPEED_KMH = 40
/**
 * A speed reading older than this is treated as unknown, so auto-open stays closed. The idle location task fires every 30 s
 * (IDLE_INTERVAL_MS), so the window must be longer than that or a parked driver would miss the gate about a third of the time.
 */
export const SPEED_MAX_AGE_MS = 45_000

export interface IconInputs {
  iconEnabled: boolean
  hasPermission: boolean
  isOnline: boolean
  appState: AppStateName
}

/** The icon is for a driver who is online and has left Ocar: hidden when Ocar is in front, offline, or the permission is off. */
export function shouldShowIcon(i: IconInputs): boolean {
  return i.iconEnabled && i.hasPermission && i.isOnline && i.appState !== 'active'
}

export interface AutoOpenInputs extends IconInputs {
  autoOpenEnabled: boolean
  /** The driver already has a ride in progress: never steal the screen then. */
  hasActiveRide: boolean
  /** Speed at fire time in km/h, or null when unknown. */
  speedKmh: number | null
  /** How old that reading is, in ms, or null when unknown. */
  speedAgeMs: number | null
}

/** Opens Ocar by itself for a new request. Every unknown (speed, age) fails closed: the notification still rings as it does today. */
export function shouldAutoOpen(i: AutoOpenInputs): boolean {
  if (!i.autoOpenEnabled || !shouldShowIcon(i) || i.hasActiveRide) return false
  if (i.speedKmh === null || i.speedAgeMs === null) return false
  if (i.speedAgeMs > SPEED_MAX_AGE_MS || i.speedAgeMs < 0) return false
  if (!Number.isFinite(i.speedKmh) || i.speedKmh < 0) return false
  return i.speedKmh <= AUTO_OPEN_MAX_SPEED_KMH
}

/** Location speed is metres per second and negative or null when the phone has no fix; convert to km/h, null when unusable. */
export function speedKmhFromMps(mps: number | null | undefined): number | null {
  if (mps === null || mps === undefined || !Number.isFinite(mps) || mps < 0) return null
  return mps * 3.6
}

export interface RequestChange {
  /** The ride id to remember for the next change (null once nothing is pending). */
  last: string | null
  /** No request is waiting any more: clear the icon's dot. */
  clearAlert: boolean
  /** A new request arrived while Ocar is not in front: show the dot and pulse, and consider opening Ocar. */
  notify: boolean
}

/**
 * Decides what a change in the pending ride request means for the icon. `last` must go back to null when the request clears, so
 * the same ride offered again to this driver (a later broadcast round) counts as new; a request that arrives while Ocar is in
 * front is already shown by the in-app card, so it is remembered but not announced.
 */
export function onPendingChange(last: string | null, next: string | null, appState: AppStateName): RequestChange {
  if (next === null) return { last: null, clearAlert: true, notify: false }
  if (next === last) return { last, clearAlert: false, notify: false }
  return { last: next, clearAlert: false, notify: appState !== 'active' }
}
