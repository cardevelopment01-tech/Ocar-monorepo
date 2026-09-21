import type { RideStatus } from './reducer'

export type RelaunchRideSummary = { id: string; status: RideStatus } | null

// Pure mapping, unit-tested per the Eng review finding: a silently-wrong mapping
// here strands a driver on the tab shell instead of their active ride (or vice
// versa) after a relaunch. `status` is accepted for future per-status routing
// (e.g. a distinct cash-collection route) but this phase renders every active
// status inside one dynamic screen, so it does not yet branch on it.
export function relaunchRoute(activeRide: RelaunchRideSummary): string {
  return activeRide ? `/active-ride/${activeRide.id}` : '/(tabs)/home'
}
