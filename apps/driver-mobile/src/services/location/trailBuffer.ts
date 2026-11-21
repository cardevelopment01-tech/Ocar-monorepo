import AsyncStorage from '@react-native-async-storage/async-storage'

// The trip's GPS trail, kept on the phone and uploaded in batches. Live pings are best-effort: when the phone has no signal (or Android
// freezes the app) they are simply lost, and a one-way fare is now billed on the km along that trail. So during a trip every accepted
// fix is also saved here and sent to POST /rides/:id/track; whatever has not been confirmed stays until a later upload succeeds.
// The record lives on disk because the location task can run in a bare background process, and the app can be killed and reopened mid-trip.

export type TrailFix = { lat: number; lng: number; heading?: number; speed?: number; accuracy?: number; recordedAt: string }
type Saved = { rideId: string | null; fixes: TrailFix[] }

// ~4,000 fixes is about 3.5 h at one per 3 s and stays well under Android AsyncStorage's 2 MB-per-row read limit.
export const MAX_BUFFERED_FIXES = 4000
const BATCH_SIZE = 300 // the server's cap
const PERSIST_EVERY_MS = 10_000 // a kill loses at most this much of what was not yet uploaded
const FLUSH_EVERY_MS = 30_000
const PERMANENT_REFUSALS = new Set([400, 403, 404, 422])

export interface TrailDeps {
  load: () => Promise<string | null>
  save: (value: string) => Promise<void>
  post: (rideId: string, fixes: TrailFix[]) => Promise<void>
  now: () => number
}

function parse(raw: string | null): Saved {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<Saved>) : null
    return { rideId: typeof v?.rideId === 'string' ? v.rideId : null, fixes: Array.isArray(v?.fixes) ? v.fixes : [] }
  } catch {
    return { rideId: null, fixes: [] }
  }
}

export function createTrailBuffer(deps: TrailDeps) {
  let state: Saved | null = null
  let lastPersistAt = 0
  let lastFlushAt = 0
  let flushing: Promise<void> | null = null

  const get = async (): Promise<Saved> => (state ??= parse(await deps.load()))
  const persist = async (force: boolean): Promise<void> => {
    if (!state || (!force && deps.now() - lastPersistAt < PERSIST_EVERY_MS)) return
    lastPersistAt = deps.now()
    await deps.save(JSON.stringify(state)).catch(() => undefined)
  }

  // The trip has started (or the app reopened mid-trip): save fixes for this ride. Idempotent for the same ride; a different ride resets it.
  async function start(rideId: string): Promise<void> {
    const s = await get()
    if (s.rideId === rideId) return
    s.rideId = rideId
    s.fixes = []
    await persist(true)
  }

  async function add(fixes: TrailFix[]): Promise<void> {
    const s = await get()
    if (!s.rideId || fixes.length === 0) return
    s.fixes.push(...fixes)
    if (s.fixes.length > MAX_BUFFERED_FIXES) s.fixes.splice(0, s.fixes.length - MAX_BUFFERED_FIXES)
    await persist(false)
    if (deps.now() - lastFlushAt >= FLUSH_EVERY_MS) void flush()
  }

  // Uploads in batches, oldest first; a batch is removed only after the server confirmed it. Never throws.
  function flush(): Promise<void> {
    if (flushing) return flushing
    flushing = (async () => {
      const s = await get()
      if (!s.rideId || s.fixes.length === 0) return
      lastFlushAt = deps.now()
      while (s.fixes.length > 0) {
        const sent = s.fixes.slice(0, BATCH_SIZE)
        try {
          await deps.post(s.rideId, sent)
        } catch (err) {
          // The server refused it for good (bad data, not our ride): keeping it would retry forever. 401/408/429 are temporary
          // (expired token, timeout, rate limit), so those keep the trail for the next try.
          const status = (err as { response?: { status?: number } })?.response?.status
          if (status !== undefined && PERMANENT_REFUSALS.has(status)) s.fixes = []
          await persist(true)
          return
        }
        s.fixes.splice(0, sent.length) // fixes added during the upload sit after these, so the front is exactly what was sent
      }
      await persist(true)
    })().catch(() => undefined).finally(() => { flushing = null })
    return flushing
  }

  // The trip is over: send what is left, then forget the ride.
  async function end(): Promise<void> {
    await flush()
    const s = await get()
    s.rideId = null
    s.fixes = []
    await persist(true)
  }

  return { start, add, flush, end }
}

// `api` is required lazily for the reason given in locationSync.ts (an import cycle through useAuthStore).
export const trail = createTrailBuffer({
  load: () => AsyncStorage.getItem('ocar_driver_trip_trail'),
  save: (v) => AsyncStorage.setItem('ocar_driver_trip_trail', v),
  post: async (rideId, fixes) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy require, see locationSync.ts
    const { api } = require('@/services/api') as typeof import('@/services/api')
    await api.post(`/api/v1/rides/${rideId}/track`, { fixes })
  },
  now: () => Date.now(),
})
