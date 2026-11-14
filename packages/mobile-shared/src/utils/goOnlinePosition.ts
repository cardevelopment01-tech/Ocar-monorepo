// Which position a driver sends when they go online. Pure: the three sources are injected, so every branch is unit-tested and this file
// has no expo-location import.
//
// Going online used to wait for a FRESH GPS fix (up to 8 s) before calling the server, which answers in about 30 ms. The server does not
// use the position to decide whether the driver may go online (it uses their assigned city); the position only seeds their first location,
// and live tracking replaces it moments later. So: a recent OS fix first (instant), then a fresh one under a short cap, then any last-known
// one, and only then give up (the caller falls back to a default centre and warns). The two "instant" lookups are capped as well: a phone
// that is slow to answer must not bring the spinner back.

export type GoOnlineSources<T> = {
  /** A recent, reasonably accurate OS fix. Null when there is none. */
  recent: () => Promise<T | null>
  /** A fresh fix. The caller caps how long this may take by rejecting. */
  fresh: () => Promise<T>
  /** Any last-known fix, however old. Null when there is none. */
  last: () => Promise<T | null>
}

export type GoOnlineOptions = {
  /** The longest the `recent` and `last` lookups may take before they count as "no fix". Default 1000 ms. */
  lookupCapMs?: number
}

const DEFAULT_LOOKUP_CAP_MS = 1000

function capped<T>(lookup: () => Promise<T | null>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    Promise.resolve().then(lookup).then(
      (value) => { clearTimeout(timer); resolve(value) },
      () => { clearTimeout(timer); resolve(null) },
    )
  })
}

export async function resolveGoOnlinePosition<T>(sources: GoOnlineSources<T>, options: GoOnlineOptions = {}): Promise<T> {
  const cap = options.lookupCapMs ?? DEFAULT_LOOKUP_CAP_MS
  const recent = await capped(sources.recent, cap)
  if (recent) return recent
  try {
    return await sources.fresh()
  } catch {
    const last = await capped(sources.last, cap)
    if (!last) throw new Error('no_location_available')
    return last
  }
}
