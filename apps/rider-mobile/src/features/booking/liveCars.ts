import type { NearbyCar } from '../ride-tracking/nearbyCars'
import { metresBetween } from '../ride-tracking/nearbyCars'

// The set of available cars shown on a searching rider's map, kept from two sources:
//  - LIVE positions pushed over the socket (`nearby:car`, about one per driver every 3 s), and
//  - a SNAPSHOT from the REST feed (`GET /rides/nearby-drivers`), fetched when the screen opens and then only occasionally.
// The snapshot makes the map instant and is the fallback when the push is not reaching the phone (an older server, a
// dropped socket); live positions win whenever they are fresh. A car nobody has heard from lately is dropped.
// Pure: no React Native, so every rule is unit-tested.

export type LiveCar = { driverId: string; lat: number; lng: number; heading?: number; seenAt: number; source: 'live' | 'snapshot' }
export type LiveCars = ReadonlyMap<string, LiveCar>

/** Live cars ping about every 3 s: this is three missed pings in a row. */
export const LIVE_TTL_MS = 10_000
/** Snapshot cars are refreshed every 8 s when there is no live push (see useNearbyDrivers), so they must outlive that. */
export const SNAPSHOT_TTL_MS = 20_000
/** A snapshot position only replaces a live one that is at least this old. */
export const LIVE_FRESH_MS = 5_000
/** The rider's map frames and shows cars within this distance of the pickup, which the server's cells always cover. */
export const SHOW_WITHIN_M = 3_000

export type CarEvent = { id: string; lat: number; lng: number; heading?: number }

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** Validate a `nearby:car` payload from the socket (untrusted input). Null = ignore it. */
export function parseCarEvent(raw: unknown): CarEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const { id, lat, lng, heading } = r
  if (typeof id !== 'string' || !ID_RE.test(id)) return null
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return null
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return null
  const ev: CarEvent = { id, lat, lng }
  if (typeof heading === 'number' && Number.isFinite(heading) && heading >= 0 && heading <= 360) ev.heading = heading
  return ev
}

/** A live position: always the newest word on that car. */
export function applyLive(prev: LiveCars, ev: CarEvent, now: number): LiveCars {
  const next = new Map(prev)
  const car: LiveCar = { driverId: ev.id, lat: ev.lat, lng: ev.lng, seenAt: now, source: 'live' }
  if (ev.heading !== undefined) car.heading = ev.heading
  next.set(ev.id, car)
  return next
}

/** A REST snapshot: fills in cars we have not heard live, and replaces a live position only once that has gone stale. */
export function applySnapshot(prev: LiveCars, snapshot: readonly NearbyCar[], now: number): LiveCars {
  const next = new Map(prev)
  for (const s of snapshot) {
    const have = next.get(s.driverId)
    if (have && have.source === 'live' && now - have.seenAt < LIVE_FRESH_MS) continue
    const car: LiveCar = { driverId: s.driverId, lat: s.lat, lng: s.lng, seenAt: now, source: 'snapshot' }
    if (s.heading !== undefined) car.heading = s.heading
    next.set(s.driverId, car)
  }
  return next
}

/** Drop cars not heard from within their source's time limit. Returns the same map when nothing expired. */
export function expireCars(prev: LiveCars, now: number): LiveCars {
  let next: Map<string, LiveCar> | null = null
  for (const [id, c] of prev) {
    const ttl = c.source === 'live' ? LIVE_TTL_MS : SNAPSHOT_TTL_MS
    if (now - c.seenAt > ttl) {
      next ??= new Map(prev)
      next.delete(id)
    }
  }
  return next ?? prev
}

/** True when a live position arrived recently: the push works, so the snapshot only needs to refresh rarely. */
export function liveIsFlowing(cars: LiveCars, now: number): boolean {
  for (const c of cars.values()) if (c.source === 'live' && now - c.seenAt <= LIVE_TTL_MS) return true
  return false
}

/** The cars to draw: those near the pickup, nearest first, in the shape the map takes. */
export function carsNear(cars: LiveCars, pickup: [number, number], within = SHOW_WITHIN_M): NearbyCar[] {
  const out: Array<{ car: NearbyCar; d: number }> = []
  for (const c of cars.values()) {
    const d = metresBetween(pickup, [c.lat, c.lng])
    if (d > within) continue
    const car: NearbyCar = { driverId: c.driverId, lat: c.lat, lng: c.lng }
    if (c.heading !== undefined) car.heading = c.heading
    out.push({ car, d })
  }
  return out.sort((a, b) => a.d - b.d).map((o) => o.car)
}

/** Whether two car lists would draw identically, so the map is not re-rendered for nothing. */
export function sameCars(a: readonly NearbyCar[], b: readonly NearbyCar[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.driverId !== y.driverId || x.lat !== y.lat || x.lng !== y.lng || x.heading !== y.heading) return false
  }
  return true
}
