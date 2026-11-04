import { haversineMetres } from './polyline'
import {
  FIX_TIMEOUT_MS,
  JITTER_M,
  ageMs,
  isFresh,
  movedBeyondGeocodeReuse,
  pickBest,
  shouldGeocode,
  type Fix,
  type FixSource,
} from './locationPolicy'

// The rider's location, as one foreground watcher feeding one value. No React Native imports: expo-location, the
// reverse-geocoder, the clock and telemetry come in as `deps`, so every branch can be tested with fakes.
//
// Why a watcher and not a one-shot "get current position with a timeout": the one-shot's result is thrown away when the
// timeout fires (the native request cannot be cancelled), so a slow cold-start fix never arrived. A watcher simply
// delivers the fix whenever it comes, and keeps delivering, so the value cannot silently go stale while the app is open.

export type LocationSlice = {
  lat: number | null
  lng: number | null
  address: string
  fixedAt: number | null
  source: FixSource | null
  timedOut: boolean
  ready: boolean
}

export type LocationDeps = {
  /** Starts the foreground watcher; resolves to something that stops it. */
  watch: (onFix: (fix: Fix) => void) => Promise<{ remove: () => void }>
  /** The OS's cached position (instant, maybe old). Resolves null when there is none. Never rejects. */
  lastKnown: () => Promise<Fix | null>
  geocode: (lat: number, lng: number) => Promise<string>
  now: () => number
  track: (event: string, props: Record<string, string | number | boolean | null>) => void
}

const GEOCODE_RETRY_MS = 15_000

export function createLocationEngine(io: {
  get: () => LocationSlice
  set: (patch: Partial<LocationSlice>) => void
  deps: LocationDeps
}) {
  const { get, set, deps } = io

  let active = false
  let token = 0
  let sub: { remove: () => void } | undefined
  let capTimer: ReturnType<typeof setTimeout> | undefined

  let geocodeSeq = 0
  let geocoding = false
  let anchor: { lat: number; lng: number } | null = null // where the current address was looked up
  let retryAt = 0

  let activatedAt = 0
  let waitingForFreshFix = false
  let hadSavedAtActivation = false
  let savedAgeAtActivation: number | null = null

  const current = (): Fix | null => {
    const { lat, lng, fixedAt, source } = get()
    return lat === null || lng === null || fixedAt === null ? null : { lat, lng, fixedAt, source: source ?? 'cache' }
  }

  function startGeocode(fix: Fix) {
    const seq = ++geocodeSeq
    geocoding = true
    anchor = { lat: fix.lat, lng: fix.lng }
    deps
      .geocode(fix.lat, fix.lng)
      .then((address) => {
        if (seq !== geocodeSeq) return
        geocoding = false
        set({ address })
      })
      .catch(() => {
        if (seq !== geocodeSeq) return
        geocoding = false
        anchor = null
        retryAt = deps.now() + GEOCODE_RETRY_MS // coordinates alone are usable; do not hammer the geocoder on every fix
      })
  }

  /** Newer fix wins. Never throws; safe to call with anything the OS hands back. */
  function receive(incoming: Fix | null) {
    const now = deps.now()
    const prev = current()
    const best = pickBest(prev, incoming, now)
    if (!best || best === prev) return

    if (waitingForFreshFix && best.source !== 'cache' && isFresh(best, now)) {
      waitingForFreshFix = false
      const props: Record<string, string | number | boolean | null> = {
        ms: now - activatedAt,
        source: best.source,
        had_saved: hadSavedAtActivation,
        saved_age_s: savedAgeAtActivation === null ? null : Math.round(savedAgeAtActivation / 1000),
        after_timeout: get().timedOut,
      }
      if (best.accuracy !== undefined) props['accuracy_m'] = Math.round(best.accuracy)
      deps.track('location_fix_ready', props)
    }

    // A fix within jitter distance of the last one only refreshes its timestamp, so the map and every lat/lng reader
    // stay still while the rider is standing.
    const sameSpot = prev !== null && haversineMetres([prev.lat, prev.lng], [best.lat, best.lng]) < JITTER_M
    const patch: Partial<LocationSlice> = { fixedAt: best.fixedAt, source: best.source, ready: true }
    if (!sameSpot) {
      patch.lat = best.lat
      patch.lng = best.lng
    }
    if (isFresh(best, now)) patch.timedOut = false

    // The address stays while the rider is within reuse range of where it was looked up (not of the previous fix, or a
    // slow walk would drift away from its address without ever tripping the check).
    const ref = anchor ?? (get().address && prev ? { lat: prev.lat, lng: prev.lng } : null)
    const moved = movedBeyondGeocodeReuse(ref, best)
    if (moved && ref && get().address) patch.address = ''
    set(patch)

    if (shouldGeocode(best, now) && now >= retryAt && (moved || (!get().address && !geocoding))) startGeocode(best)
  }

  function armCap() {
    clearTimeout(capTimer)
    capTimer = setTimeout(() => {
      if (active && !isFresh(current(), deps.now())) {
        set({ timedOut: true, ready: true })
        deps.track('location_timeout', { had_saved: current() !== null })
      }
    }, FIX_TIMEOUT_MS)
  }

  /** Start (or re-arm) tracking. Idempotent: safe on launch, on foreground, on screen focus. */
  async function activate() {
    const now = deps.now()
    const cur = current()
    activatedAt = now
    hadSavedAtActivation = cur !== null
    savedAgeAtActivation = cur ? ageMs(cur.fixedAt, now) : null
    waitingForFreshFix = !isFresh(cur, now)
    set({ timedOut: false })
    armCap()
    void deps.lastKnown().then(receive)
    if (active) return
    active = true
    const mine = ++token
    try {
      const s = await deps.watch(receive)
      if (mine !== token || !active) s.remove() // stopped (or restarted) while the watcher was starting
      else sub = s
    } catch {
      if (mine !== token) return
      active = false
      set({ ready: true, timedOut: !isFresh(current(), deps.now()) })
    }
  }

  function deactivate() {
    active = false
    token++
    sub?.remove()
    sub = undefined
    clearTimeout(capTimer)
  }

  /** Forget everything about the saved place (sign-out). */
  function reset() {
    geocodeSeq++
    geocoding = false
    anchor = null
    retryAt = 0
  }

  return { receive, activate, deactivate, reset, isActive: () => active }
}
