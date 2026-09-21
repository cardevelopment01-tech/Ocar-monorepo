import * as Location from 'expo-location'

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
