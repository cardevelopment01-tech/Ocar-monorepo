import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { readPersistedSessionId } from './persistedSession'

// The in-memory session id, or (in a bare background process after the app was killed, before the session is re-derived) the one on disk.
async function resolveSessionId(): Promise<string | null> {
  return useDriverSessionStore.getState().sessionId ?? (await readPersistedSessionId())
}

// `socket` and `api` are required lazily inside emitLocationTick, not imported
// at module scope -- backgroundTask.ts (which imports this module) is itself
// imported from useAuthStore.ts (for its cleanup-on-logout calls), and both
// services/socket and services/api import useAuthStore.ts. A top-level import
// here would close that cycle and leave useAuthStore undefined partway through
// its own module evaluation (observed on-device: "Cannot read property
// 'getState' of undefined" inside createSocket's eager getToken() call).
// Requiring inside the function defers evaluation until the module graph has
// already settled.
function getSocket(): typeof import('@/services/socket').socket {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy require, see file header comment
  return (require('@/services/socket') as typeof import('@/services/socket')).socket
}

function getApi(): typeof import('@/services/api').api {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy require, see file header comment
  return (require('@/services/api') as typeof import('@/services/api')).api
}

export type LocationFix = {
  lat: number
  lng: number
  heading?: number
  speed?: number
  recordedAt: string
}

// Debounce the HTTP fallback against socket flapping (rapid reconnect/disconnect
// blips) -- only fall back once genuinely disconnected for a sustained period,
// not on every brief drop, to avoid overlapping HTTP + socket ticks (Eng review
// finding, Days 8-10 plan).
const FALLBACK_DEBOUNCE_MS = 2000
let disconnectedSinceMs: number | null = null

// HTTP fallback guard: at most one POST in flight, and after a failure wait out an
// exponential backoff (3s -> 30s) instead of stacking a new 10s-timeout request on every
// 3s tick while the network is down (each held the radio up and most were doomed).
const BACKOFF_START_MS = 3000
const BACKOFF_MAX_MS = 30_000
let httpInFlight = false
let httpBackoffMs = 0
let httpRetryAt = 0

// "Still here" without a position. The location task can run with a fix that is dropped for poor accuracy, or a driver can sit still, and
// the server only learns the driver is alive from a position; this tells it directly. Rate-limited (the task runs every 3 s on a ride).
const HEARTBEAT_MIN_INTERVAL_MS = 20_000
let lastHeartbeatAtMs = 0
let heartbeatHttpInFlight = false

type HeartbeatDeps = {
  socket: Pick<ReturnType<typeof getSocket>, 'connected' | 'timeout'>
  api: Pick<ReturnType<typeof getApi>, 'post'>
}
const HEARTBEAT_ACK_TIMEOUT_MS = 5000

// `deps` is for tests only; the app resolves the socket and API lazily (see the file header).
export async function emitHeartbeat(nowMs: number = Date.now(), deps?: HeartbeatDeps): Promise<void> {
  const sessionId = await resolveSessionId()
  if (!sessionId) return
  if (nowMs - lastHeartbeatAtMs < HEARTBEAT_MIN_INTERVAL_MS) return
  lastHeartbeatAtMs = nowMs
  const socket = deps?.socket ?? getSocket()
  if (socket.connected) {
    // A socket that says "connected" can be half dead (a network blip, a sleeping radio): ask the server to confirm it got the heartbeat.
    const delivered = await new Promise<boolean>((resolve) => {
      socket.timeout(HEARTBEAT_ACK_TIMEOUT_MS).emit('driver:heartbeat', { sessionId }, (err: unknown, res?: { ok?: boolean }) => resolve(!err && res?.ok === true))
    })
    if (delivered) return
  }
  // No socket, or no confirmation: one HTTP call, best effort. If that fails too the next task run tries again at once.
  if (heartbeatHttpInFlight) return
  heartbeatHttpInFlight = true
  try {
    await (deps?.api ?? getApi()).post('/api/v1/rides/sessions/heartbeat', { sessionId })
  } catch {
    lastHeartbeatAtMs = 0
  } finally {
    heartbeatHttpInFlight = false
  }
}

export function resetHeartbeatForTests(): void { lastHeartbeatAtMs = 0; heartbeatHttpInFlight = false }

export async function emitLocationTick(fix: LocationFix): Promise<void> {
  const sessionId = await resolveSessionId()
  if (!sessionId) return // not online -- nothing to report against

  const socket = getSocket()
  if (socket.connected) {
    disconnectedSinceMs = null
    socket.emit('location:update', { sessionId, ...fix })
    return
  }

  if (disconnectedSinceMs === null) disconnectedSinceMs = Date.now()
  if (Date.now() - disconnectedSinceMs < FALLBACK_DEBOUNCE_MS) return

  if (httpInFlight || Date.now() < httpRetryAt) return
  httpInFlight = true
  try {
    await getApi().post('/api/v1/rides/sessions/location', { sessionId, ...fix })
    httpBackoffMs = 0
  } catch {
    // Best-effort, like the web driver app's fire-and-forget POST; a later tick retries once
    // the backoff has elapsed.
    httpBackoffMs = Math.min(httpBackoffMs ? httpBackoffMs * 2 : BACKOFF_START_MS, BACKOFF_MAX_MS)
    httpRetryAt = Date.now() + httpBackoffMs
  } finally {
    httpInFlight = false
  }
}
