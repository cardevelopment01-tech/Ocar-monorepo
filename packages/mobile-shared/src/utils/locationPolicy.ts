import { haversineMetres } from './polyline'

// Pure rules for the "instant location" behaviour (saved fix -> OS last-known -> fresh GPS).
// Kept free of expo-location / React Native imports so vitest (plain node) can test every branch.
// Numbers come from the eng + design review: 2 min live window, 30 min "recent" window, 8 s fix cap,
// 150 m geocode reuse radius, 1 km camera glide-vs-snap cutoff.

export type FixSource = 'cache' | 'os' | 'gps'
export type PermissionState = 'unknown' | 'granted' | 'denied'
export type Freshness = 'live' | 'recent' | 'old' | 'timeout' | 'denied'

export type Fix = { lat: number; lng: number; fixedAt: number; source: FixSource }
type Point = { lat: number; lng: number }

export const FRESH_MS = 2 * 60_000
export const OLD_MS = 30 * 60_000
export const FIX_TIMEOUT_MS = 8000
export const GEOCODE_REUSE_M = 150
export const CAMERA_GLIDE_MAX_M = 1000

const SOURCE_RANK: Record<FixSource, number> = { cache: 0, os: 1, gps: 2 }

/** Milliseconds since the fix. A timestamp in the future (clock changed) counts as infinitely old. */
export function ageMs(fixedAt: number, now: number): number {
  const age = now - fixedAt
  return age < 0 ? Number.POSITIVE_INFINITY : age
}

/** A fix the booking flow may trust: a real GPS fix this launch, or any fix younger than FRESH_MS. */
export function isFresh(fix: Fix | null, now: number): boolean {
  if (!fix) return false
  return fix.source === 'gps' || ageMs(fix.fixedAt, now) < FRESH_MS
}

/** Newer timestamp wins; a future timestamp never wins; ties go to the better source (gps > os > cache). */
export function pickBest(current: Fix | null, incoming: Fix | null, now: number): Fix | null {
  if (!incoming) return current
  if (!current) return incoming
  const t = (f: Fix) => (f.fixedAt > now ? Number.NEGATIVE_INFINITY : f.fixedAt)
  if (t(incoming) > t(current)) return incoming
  if (t(incoming) === t(current) && SOURCE_RANK[incoming.source] > SOURCE_RANK[current.source]) return incoming
  return current
}

export function ageBucket(fixedAt: number, now: number): 'live' | 'recent' | 'old' {
  const age = ageMs(fixedAt, now)
  if (age < FRESH_MS) return 'live'
  if (age < OLD_MS) return 'recent'
  return 'old'
}

/** One value drives the home pill, ring dot, pulse, blue dot and the booking label, so they flip together. */
export function freshnessOf(input: {
  permission: PermissionState
  fix: Fix | null
  timedOut: boolean
  now: number
}): Freshness {
  const { permission, fix, timedOut, now } = input
  if (permission === 'denied') return 'denied'
  if (isFresh(fix, now)) return 'live'
  if (timedOut) return 'timeout'
  if (fix && ageBucket(fix.fixedAt, now) === 'recent') return 'recent'
  return 'old'
}

export const PILL_FINDING = 'Finding your location…'
export const PILL_SET_PICKUP = 'Set pickup location'
export const PILL_DENIED = 'Location off · Set pickup location'
export const PILL_CURRENT = 'Current location'

export type PillContent = { text: string; tappable: boolean; muted: boolean }

export function pillTextFor(freshness: Freshness, address: string): PillContent {
  switch (freshness) {
    case 'live':
      return { text: address || PILL_CURRENT, tappable: false, muted: false }
    case 'recent':
      return { text: address || PILL_FINDING, tappable: false, muted: !!address }
    case 'old':
      return { text: PILL_FINDING, tappable: false, muted: false }
    case 'timeout':
      return { text: PILL_SET_PICKUP, tappable: true, muted: false }
    case 'denied':
      return { text: PILL_DENIED, tappable: true, muted: false }
  }
}

export function a11yLabelFor(freshness: Freshness, address: string): string {
  const { text } = pillTextFor(freshness, address)
  return `Pickup: ${text.replace(/…$/, '').replace(' · ', ', ')}`
}

/** Under 1 km the camera glides; from 1 km it snaps (gliding across a city looks broken). */
export function cameraMode(distanceMetres: number): 'glide' | 'snap' {
  return distanceMetres < CAMERA_GLIDE_MAX_M ? 'glide' : 'snap'
}

/** True when the saved address no longer describes the new position (or there is nothing to compare). */
export function movedBeyondGeocodeReuse(prev: Point | null, next: Point): boolean {
  if (!prev) return true
  return haversineMetres([prev.lat, prev.lng], [next.lat, next.lng]) >= GEOCODE_REUSE_M
}

/** Only these fields may be written to disk: persisting `initialized`/`ready` would stop init() from ever running again. */
export function partializeLocation<T extends { lat: number | null; lng: number | null; address: string; fixedAt: number | null }>(
  state: T
): { lat: number | null; lng: number | null; address: string; fixedAt: number | null } {
  return { lat: state.lat, lng: state.lng, address: state.address, fixedAt: state.fixedAt }
}
