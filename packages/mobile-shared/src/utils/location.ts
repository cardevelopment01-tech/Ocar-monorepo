import * as Location from 'expo-location'

// getCurrentPositionAsync can fail even when location is genuinely enabled -- e.g. Play
// Services' settings-resolution call failing independent of the OS-level toggle (observed
// on emulators). A cached last-known position is a reasonable fallback for anything that
// just needs a default pin, rather than surfacing a hard error for a live-fix hiccup.
export async function getCurrentOrLastKnownPosition(): Promise<Location.LocationObject> {
  try {
    return await Location.getCurrentPositionAsync({})
  } catch {
    const last = await Location.getLastKnownPositionAsync()
    if (!last) throw new Error('no_location_available')
    return last
  }
}
