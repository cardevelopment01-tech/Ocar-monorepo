// Which position a driver sends when they go online. Pure: the three sources are injected, so every branch is unit-tested and this file
// has no expo-location import.
//
// Going online used to wait for a FRESH GPS fix (up to 8 s) before calling the server, which answers in about 30 ms. The server does not
// use the position to decide whether the driver may go online (it uses their assigned city); the position only seeds their first location,
// and live tracking replaces it moments later. So: a recent OS fix first (instant), then a fresh one under a short cap, then any last-known
// one, and only then give up (the caller falls back to a default centre and warns).

export type GoOnlineSources<T> = {
  /** A recent, reasonably accurate OS fix. Null when there is none. */
  recent: () => Promise<T | null>
  /** A fresh fix. The caller caps how long this may take by rejecting. */
  fresh: () => Promise<T>
  /** Any last-known fix, however old. Null when there is none. */
  last: () => Promise<T | null>
}

export async function resolveGoOnlinePosition<T>(sources: GoOnlineSources<T>): Promise<T> {
  try {
    const recent = await sources.recent()
    if (recent) return recent
  } catch {
    // no usable recent fix: carry on to a fresh one
  }
  try {
    return await sources.fresh()
  } catch {
    const last = await sources.last().catch(() => null)
    if (!last) throw new Error('no_location_available')
    return last
  }
}
