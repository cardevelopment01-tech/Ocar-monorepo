import { useEffect } from 'react'
import { AppState } from 'react-native'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { useAuthStore } from '@/store/useAuthStore'
import { connectSocket, disconnectSocket } from '@/services/socket'
import { stopBackgroundTracking } from '@/services/location/backgroundTask'
import { fetchCurrentSession } from './api'
import { decideSessionSync } from './sessionReconcile'

/**
 * Makes the local Online/Offline state match the server's. Safe to call any time; used when the app returns to the
 * foreground and when the screen first checks the session.
 *
 * If the store changed while the request was in flight (e.g. the driver tapped Go Online), that newer local state
 * wins and nothing is applied.
 */
export async function resyncSessionFromServer(): Promise<void> {
  const before = useDriverSessionStore.getState()
  const server = await fetchCurrentSession()
  const now = useDriverSessionStore.getState()
  if (now.sessionId !== before.sessionId || now.isOnline !== before.isOnline) return

  const action = decideSessionSync({ isOnline: now.isOnline, sessionId: now.sessionId }, server)
  if (action === 'go_offline') {
    await stopBackgroundTracking().catch(() => {})
    disconnectSocket()
    now.setOffline()
  } else if (action === 'go_online' && server) {
    now.setOnline({ id: server.id, vehicleId: server.vehicleId, categoryId: server.categoryId, mode: server.mode })
    connectSocket()
  }
}

/** Re-syncs whenever the app comes back to the foreground, so a stale "Online" toggle never outlives the session. */
export function useSessionResync(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    if (!isAuthenticated) return
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void resyncSessionFromServer().catch(() => {}) // best effort; next foreground retries
    })
    return () => sub.remove()
  }, [isAuthenticated])
}
