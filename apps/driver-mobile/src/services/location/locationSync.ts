import { socket } from '@/services/socket'
import { api } from '@/services/api'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'

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

  if (socket.connected) {
    disconnectedSinceMs = null
    socket.emit('location:update', { sessionId, ...fix })
    return
  }

  if (disconnectedSinceMs === null) disconnectedSinceMs = Date.now()
  if (Date.now() - disconnectedSinceMs < FALLBACK_DEBOUNCE_MS) return

  try {
    await api.post('/api/v1/rides/sessions/location', { sessionId, ...fix })
  } catch {
    // Best-effort -- the next ~3s tick retries, matches the existing web driver
    // app's fire-and-forget location POST pattern.
  }
}
