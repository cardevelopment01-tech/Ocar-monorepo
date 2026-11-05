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
  /** Metres of uncertainty of the fix now held, when the OS gave one. Not persisted (a saved fix has none). */
  accuracy: number | null
}

export type LocationDeps = {
  /** Starts the foreground watcher; resolves to something that stops it. */
  watch: (onFix: (fix: Fix) => void, onError: () => void) => Promise<{ remove: () => void }>
  /** One fresh reading, no timeout (a late answer is still applied). Rejects on failure. Used to nudge a quiet watcher. */
  currentFix: () => Promise<Fix>
  /** The OS's cached position (instant, maybe old). Resolves null when there is none. Never rejects. */
  lastKnown: () => Promise<Fix | null>
  geocode: (lat: number, lng: number) => Promise<string>
  now: () => number
  track: (event: string, props: Record<string, string | number | boolean | null>) => void
}

const GEOCODE_RETRY_MS = 15_000
const QUIET_CHECK_MS = 15_000 // how often a running watcher is checked for having gone quiet
const QUIET_AFTER_MS = 30_000 // no new fix for this long: ask for one directly (iOS reports nothing while stationary)
const WATCH_RESTART_MS = 3_000
const WATCH_MAX_RESTARTS = 5 // then rely on one-shot readings: a platform that keeps refusing the watcher must not be hammered
const ACCURACY_FLOOR_M = 200 // a fix worse than this AND 3x worse than a current one is ignored

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
  let quietTimer: ReturnType<typeof setInterval> | undefined
  let restartTimer: ReturnType<typeof setTimeout> | undefined
  let restarts = 0
  let kicking = false
  let wanted = false // the caller wants tracking on (survives a watcher dying)
  let epoch = 0 // bumped by reset(): answers started before it must not repopulate a wiped store

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
    if (lat === null || lng === null || fixedAt === null) return null
    const fix: Fix = { lat, lng, fixedAt, source: source ?? 'cache' }
    const { accuracy } = get()
    if (accuracy !== null) fix.accuracy = accuracy
    return fix
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
  function receive(raw: Fix | null) {
    const now = deps.now()
    // A provider timestamp ahead of our clock (a few hundred ms of skew is enough) would count as "from the future", be
    // ranked last and never become live. A fix cannot be newer than now.
    const incoming = raw && raw.fixedAt > now ? { ...raw, fixedAt: now } : raw
    const prev = current()
    // A saved address belongs to where the saved fix was; remember that spot once, so a slow drift away from it is caught.
    if (anchor === null && prev && get().address) anchor = { lat: prev.lat, lng: prev.lng }
    // A rough fix (network / approximate permission) must not replace a precise live one just because it is newer.
    if (
      incoming && prev && isFresh(prev, now) && incoming.accuracy !== undefined && prev.accuracy !== undefined &&
      incoming.accuracy > ACCURACY_FLOOR_M && incoming.accuracy > prev.accuracy * 3
    ) return
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
    const moved = movedBeyondGeocodeReuse(anchor, best)
    if (moved && anchor && get().address) patch.address = ''
    patch.accuracy = best.accuracy ?? null
    set(patch)

    if (shouldGeocode(best, now) && now >= retryAt && (moved || (!get().address && !geocoding))) startGeocode(best)
  }

  function armCap() {
    clearTimeout(capTimer)
    capTimer = setTimeout(() => {
      if (wanted && !isFresh(current(), deps.now())) {
        set({ timedOut: true, ready: true })
        deps.track('location_timeout', { had_saved: current() !== null })
      }
    }, FIX_TIMEOUT_MS)
  }

  function stopWatcher() {
    active = false
    token++
    sub?.remove()
    sub = undefined
  }

  function scheduleRestart() {
    clearTimeout(restartTimer)
    if (!wanted || restarts >= WATCH_MAX_RESTARTS) return
    const delay = WATCH_RESTART_MS * 2 ** restarts++ // 3 s, 6 s, 12 s, 24 s, 48 s
    restartTimer = setTimeout(() => { if (wanted) void startWatcher() }, delay)
  }

  async function startWatcher() {
    if (active) return
    active = true
    const mine = ++token
    const live = (f: Fix) => { if (mine === token && active) { restarts = 0; receive(f) } }
    const died = () => {
      if (mine !== token) return
      stopWatcher() // the native subscription stopped (location switched off, provider dropped): bring it back
      scheduleRestart()
    }
    try {
      const s = await deps.watch(live, died)
      if (mine !== token || !active) s.remove() // stopped (or restarted) while the watcher was starting
      else sub = s
    } catch {
      if (mine !== token) return
      stopWatcher()
      set({ ready: true, timedOut: !isFresh(current(), deps.now()) })
      scheduleRestart()
    }
  }

  function kickIfQuiet() {
    const cur = current()
    if (!wanted || (cur && ageMs(cur.fixedAt, deps.now()) < QUIET_AFTER_MS)) return
    if (kicking) return // one outstanding request at a time: it has no timeout of its own
    kicking = true
    const ep = epoch
    deps.currentFix().then((f) => { if (ep === epoch && wanted) receive(f) }, () => {}).finally(() => { kicking = false })
  }

  function fetchLastKnown() {
    const ep = epoch
    void deps.lastKnown().then((f) => { if (ep === epoch && wanted) receive(f) })
  }

  /** Begin tracking (launch, return to foreground). Resets the "still looking" state and the telemetry baseline. */
  async function activate() {
    wanted = true
    const now = deps.now()
    const cur = current()
    activatedAt = now
    hadSavedAtActivation = cur !== null
    savedAgeAtActivation = cur ? ageMs(cur.fixedAt, now) : null
    waitingForFreshFix = !isFresh(cur, now)
    set({ timedOut: false })
    armCap()
    clearInterval(quietTimer)
    quietTimer = setInterval(kickIfQuiet, QUIET_CHECK_MS)
    restarts = 0
    fetchLastKnown()
    kickIfQuiet() // no fresh fix yet: ask directly as well, the watcher can take a while on a cold start
    await startWatcher()
  }

  /** Cheap check on screen focus: start if not running, otherwise leave the timers and state alone. */
  async function ensure() {
    if (!wanted || !active) return activate()
    if (!isFresh(current(), deps.now())) {
      fetchLastKnown()
      kickIfQuiet()
    }
  }

  function deactivate() {
    wanted = false
    stopWatcher()
    clearTimeout(capTimer)
    clearTimeout(restartTimer)
    clearInterval(quietTimer)
  }

  /** Forget everything about the saved place (sign-out). */
  function reset() {
    epoch++
    geocodeSeq++
    geocoding = false
    anchor = null
    retryAt = 0
  }

  return { receive, activate, ensure, deactivate, reset, isActive: () => active }
}
