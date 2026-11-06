import type { NearbyCar } from './nearbyCars'

// Which nearby-car markers are on the rider's searching map right now, and how visible each one is.
//
// A marker must never be REMOVED while it might be gliding: the map library animates a marker by running a native animator
// on the underlying map marker, and removing the React marker mid-glide can leave a stray copy of it on the map (seen on
// Android: after a driver was assigned, cars that were moving stayed behind). So a car that leaves the list (it drove out of
// range, went offline, or the ride was handed to an assigned driver) is RETIRED: it fades to invisible, stays mounted until
// every glide it could have been in has finished, and only then is removed. Pure: no React Native, so each rule is tested.

export type FleetEntry = { car: NearbyCar; /** null = live (in the latest feed); else when it was retired (ms) */ retiredAt: number | null }

/** A retired car fades from this opacity to nothing over FADE_MS. */
export const FADE_FROM = 0.55
export const FADE_MS = 500
/** Longer than the longest glide (6 s), so nothing is animating when the marker is finally removed. */
export const REMOVE_AFTER_MS = 7000

/** Merge a new feed into the fleet: cars in the feed are live (positions refreshed, a retired car that reappears is revived),
 *  cars that dropped out are retired (once), and cars retired for longer than REMOVE_AFTER_MS are dropped. */
export function reconcileFleet(prev: readonly FleetEntry[], feed: readonly NearbyCar[], now: number): FleetEntry[] {
  const inFeed = new Map(feed.map((c) => [c.driverId, c]))
  const out: FleetEntry[] = []
  for (const e of prev) {
    const fresh = inFeed.get(e.car.driverId)
    if (fresh) { out.push({ car: fresh, retiredAt: null }); inFeed.delete(e.car.driverId) }
    else out.push({ car: e.car, retiredAt: e.retiredAt ?? now })
  }
  for (const c of inFeed.values()) out.push({ car: c, retiredAt: null })
  return pruneFleet(out, now)
}

/** Retire every car (a driver was assigned: the assigned car takes over). Already-retired cars keep their original time. */
export function retireAll(prev: readonly FleetEntry[], now: number): FleetEntry[] {
  return prev.map((e) => (e.retiredAt === null ? { car: e.car, retiredAt: now } : e))
}

/** Drop cars that were retired long enough ago that no glide can still be running. */
export function pruneFleet(prev: readonly FleetEntry[], now: number): FleetEntry[] {
  return prev.filter((e) => e.retiredAt === null || now - e.retiredAt < REMOVE_AFTER_MS)
}

/** 1 for a live car; a retired car fades from FADE_FROM to 0 over FADE_MS and then stays invisible until it is removed. */
export function fleetOpacity(e: FleetEntry, now: number): number {
  if (e.retiredAt === null) return 1
  const t = (now - e.retiredAt) / FADE_MS
  return t >= 1 ? 0 : FADE_FROM * (1 - Math.max(t, 0))
}

export const hasRetired = (fleet: readonly FleetEntry[]): boolean => fleet.some((e) => e.retiredAt !== null)
