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

export function intervalForRideState(hasActiveRide: boolean): number {
  return hasActiveRide ? ACTIVE_RIDE_INTERVAL_MS : IDLE_INTERVAL_MS
}

// One background stream feeds everything (server track, map marker, SOS, speed alert), so its
// accuracy follows the ride state: Balanced (Wi-Fi/cell, a few mA) while idle-online, High GPS
// only while a ride needs a precise trace. 'balanced'/'high' map to expo-location's Accuracy
// enum in backgroundTask.ts (this file stays free of native imports so vitest can load it).
export function trackingProfileForRideState(hasActiveRide: boolean): {
  intervalMs: number
  distanceMeters: number
  highAccuracy: boolean
} {
  return hasActiveRide
    ? { intervalMs: ACTIVE_RIDE_INTERVAL_MS, distanceMeters: 5, highAccuracy: true }
    : { intervalMs: IDLE_INTERVAL_MS, distanceMeters: 0, highAccuracy: false }
}
