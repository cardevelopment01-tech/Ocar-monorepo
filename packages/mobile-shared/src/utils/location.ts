import * as Location from 'expo-location'
import { FIX_TIMEOUT_MS, type Fix } from './locationPolicy'

// Matches web's own reference pattern (apps/driver/src/pages/GoOnline/StandardConfirm.tsx's
// getCurrentPosition: enableHighAccuracy: false, timeout: 8000) -- getCurrentPositionAsync
// has no built-in timeout, and calling it with no `accuracy` option (the previous behavior
// here) requests a high-precision GPS fix, which can hang for tens of seconds on a cold or
// weak signal (indoors, first fix after launch) with nothing shown but a spinner. This was
// fixed once, locally, in a single screen (driver-mobile's useConfirmGoOnline.ts, "Go Online
// taking too long") -- but every OTHER caller of this shared utility (rider-mobile's
// "Finding your location..." search screen, driver-mobile's own home-screen pin) never got
// that fix, so the identical bug kept reappearing everywhere else this function is used.
const GEOLOCATION_TIMEOUT_MS = 8000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('location_timeout')), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) }
    )
  })
}

// getCurrentPositionAsync can fail even when location is genuinely enabled -- e.g. Play
// Services' settings-resolution call failing independent of the OS-level toggle (observed
// on emulators), or simply never resolving within a reasonable time. A cached last-known
// position is a reasonable fallback for anything that just needs a default pin, rather
// than surfacing a hard error -- or hanging indefinitely -- for a live-fix hiccup.
export async function getCurrentOrLastKnownPosition(): Promise<Location.LocationObject> {
  try {
    return await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
      GEOLOCATION_TIMEOUT_MS
    )
  } catch {
    const last = await Location.getLastKnownPositionAsync()
    if (!last) throw new Error('no_location_available')
    return last
  }
}

// Rider "instant location" helpers (eng review D2). Deliberately separate from getCurrentOrLastKnownPosition above:
// driver go-online sends that function's result to the server as the driver's position, so its behaviour must not change.

const toFix = (l: Location.LocationObject, source: Fix['source']): Fix => ({
  lat: l.coords.latitude,
  lng: l.coords.longitude,
  fixedAt: l.timestamp,
  source,
})

/** OS last-known position (instant, may be old). Null when the OS has none or it is too coarse. Never throws. */
export async function getLastKnownFix(): Promise<Fix | null> {
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 24 * 60 * 60 * 1000, requiredAccuracy: 1500 })
    return last ? toFix(last, 'os') : null
  } catch {
    return null
  }
}

/** A real Balanced GPS fix (about 100 m), capped at FIX_TIMEOUT_MS. Rejects on timeout or failure. */
export function getFreshFix(): Promise<Fix> {
  return withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), FIX_TIMEOUT_MS).then((l) =>
    toFix(l, 'gps')
  )
}
