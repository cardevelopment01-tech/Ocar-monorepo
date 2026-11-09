// When the driver's home map should move its camera onto the driver.
//
// The map starts on a default region (central Bhubaneswar, about 5 km across). The camera used to be moved to the driver
// exactly once, from the first location answer -- which usually arrives before the native map is ready, and a camera call
// made before `onMapReady` silently does nothing. The car marker was then drawn at the driver's real position, outside the
// area on screen: a map with no car ("only a blank map"). Nothing moved the camera again when the driver went online.
// These rules move it once the map is ready and a position exists, and again once per online session when live GPS arrives.
// Pure: no React Native, so every case is unit-tested.

export type LatLng = [number, number]
export type RecenterState = { fix: boolean; online: boolean }
export type RecenterInput = {
  /** The native map has finished initialising (camera calls are safe). */
  mapReady: boolean
  /** The best position known (live GPS when online, else the first/last-known fix); null = none yet. */
  position: LatLng | null
  /** Live GPS position, only while the driver is online; null = none yet. */
  livePosition: LatLng | null
  isOnline: boolean
}

export const INITIAL_RECENTER: RecenterState = { fix: false, online: false }

/**
 * Where to move the camera now (null = leave it), and the state to keep. Moves at most once for the first position and once
 * per online session for the first live position, so a driver who pans the map is never dragged back.
 */
export function nextRecenter(state: RecenterState, input: RecenterInput): { target: LatLng | null; state: RecenterState } {
  // Going offline re-arms the "first live position" move for the next online session.
  let next: RecenterState = input.isOnline ? state : { ...state, online: false }
  if (!input.mapReady) return { target: null, state: next }

  if (input.isOnline && !next.online && input.livePosition) {
    next = { fix: true, online: true }
    return { target: input.livePosition, state: next }
  }
  if (!next.fix && input.position) {
    next = { ...next, fix: true }
    return { target: input.position, state: next }
  }
  return { target: null, state: next }
}
