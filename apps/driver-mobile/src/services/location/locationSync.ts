import { useDriverSessionStore } from '@/store/useDriverSessionStore'

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
  return (require('@/services/socket') as typeof import('@/services/socket')).socket
}

function getApi(): typeof import('@/services/api').api {
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

export async function emitLocationTick(fix: LocationFix): Promise<void> {
  const sessionId = useDriverSessionStore.getState().sessionId
  if (!sessionId) return // not online -- nothing to report against

  const socket = getSocket()
  if (socket.connected) {
    disconnectedSinceMs = null
    socket.emit('location:update', { sessionId, ...fix })
    return
  }

  if (disconnectedSinceMs === null) disconnectedSinceMs = Date.now()
  if (Date.now() - disconnectedSinceMs < FALLBACK_DEBOUNCE_MS) return

  try {
    await getApi().post('/api/v1/rides/sessions/location', { sessionId, ...fix })
  } catch {
    // Best-effort -- the next ~3s tick retries, matches the existing web driver
    // app's fire-and-forget location POST pattern.
  }
}
