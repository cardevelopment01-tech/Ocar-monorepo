// Pure GPS-polling policy rules, split out of backgroundTask.ts (which
// imports expo-location/expo-task-manager and can't be unit tested under
// vitest's plain-node environment) so the actual decision logic is testable.
// Matches web driver app's useDriverLocation.ts (apps/driver/src/lib/useDriverLocation.ts):
// maxAccuracyM=80 default, and interval tightens from an idle poll to a tight
// one during an active ride (web overrides syncIntervalMs the same way in
// NavigateToPickup.tsx/TripInProgress.tsx).
export const MAX_ACCURACY_M = 80
export const IDLE_INTERVAL_MS = 30_000
export const ACTIVE_RIDE_INTERVAL_MS = 3_000

// A fix with no accuracy figure at all is accepted (some platforms omit it) --
// only a fix that reports itself as worse than MAX_ACCURACY_M is rejected.
export function isAccurateEnough(accuracyM: number | null | undefined): boolean {
  return accuracyM == null || accuracyM <= MAX_ACCURACY_M
}

// Indoors, in a parking garage or between tall buildings every fix can be worse than 80 m. Dropping all of them left the server with a
// position that grew stale until matching ranked the driver by an old place and then paused them. So when no good fix has gone out for
// DEGRADED_AFTER_MS, one rough fix (up to DEGRADED_MAX_ACCURACY_M) is sent as the live position instead: still near the driver, which is
// far better than minutes old. Never during a ride: every live ping on a ride is also stored as a breadcrumb that fares are billed on,
// so a rough fix there could add phantom distance. The trip trail keeps the strict 80 m rule too.
export const DEGRADED_AFTER_MS = 120_000
export const DEGRADED_MAX_ACCURACY_M = 300

export function shouldSendLivePosition(accuracyM: number | null | undefined, msSinceLastLive: number, hasActiveRide: boolean): boolean {
  if (isAccurateEnough(accuracyM)) return true
  return !hasActiveRide && accuracyM != null && accuracyM <= DEGRADED_MAX_ACCURACY_M && msSinceLastLive >= DEGRADED_AFTER_MS
}

export function intervalForRideState(hasActiveRide: boolean): number {
  return hasActiveRide ? ACTIVE_RIDE_INTERVAL_MS : IDLE_INTERVAL_MS
}

// One background stream feeds everything (server track, map marker, SOS, speed alert), so its
// accuracy follows the ride state: High GPS the whole time the driver is online. Idle used to be Balanced (Wi-Fi/cell), which
// on a real phone in a rural area gave fixes of about 100 m: the home pin sat 100-200 m off, and every such fix failed the 80 m
// check below, so no live position was stored or sent. Only the interval differs now: slow while idle, tight during a ride.
// 'high' maps to expo-location's Accuracy enum in backgroundTask.ts (this file stays free of native imports so vitest can load it).
export function trackingProfileForRideState(hasActiveRide: boolean): {
  intervalMs: number
  distanceMeters: number
  highAccuracy: boolean
} {
  return hasActiveRide
    ? { intervalMs: ACTIVE_RIDE_INTERVAL_MS, distanceMeters: 5, highAccuracy: true }
    : { intervalMs: IDLE_INTERVAL_MS, distanceMeters: 0, highAccuracy: true }
}
