import { create } from 'zustand'
import { persistSessionId, clearPersistedSessionId } from '@/services/location/persistedSession'

// Not persisted -- re-derived on every app start via GET /sessions/current and
// GET /rides/me/active (CEO review decision: reuse the server's own source of
// truth instead of caching session state locally, since a session created on
// another device or expired server-side would otherwise go stale in storage).
export type ActiveRideSummary = {
  id: string
  status: string
}

interface DriverSessionState {
  sessionId: string | null
  isOnline: boolean
  vehicleId: number | null
  categoryId: number | null
  mode: 'standard' | 'return_cab' | null
  destinationCityName: string | null
  activeRide: ActiveRideSummary | null
  /** Background location tracking could not be started for this online session (Home tells the driver and offers a retry). */
  trackingFailed: boolean
  setOnline: (session: {
    id: string
    vehicleId: number
    categoryId: number
    mode?: 'standard' | 'return_cab'
    destinationCityName?: string | null
  }) => void
  setOffline: () => void
  setActiveRide: (ride: ActiveRideSummary | null) => void
  /** `sessionId`, when given, makes a late result from an older session a no-op; a failure is never recorded while offline. */
  setTrackingFailed: (failed: boolean, sessionId?: string) => void
}

export const useDriverSessionStore = create<DriverSessionState>()((set) => ({
  sessionId: null,
  isOnline: false,
  vehicleId: null,
  categoryId: null,
  mode: null,
  destinationCityName: null,
  activeRide: null,
  trackingFailed: false,

  setOnline: (session) => {
    persistSessionId(session.id)
    set({
      sessionId: session.id,
      isOnline: true,
      vehicleId: session.vehicleId,
      categoryId: session.categoryId,
      mode: session.mode ?? 'standard',
      destinationCityName: session.destinationCityName ?? null,
      trackingFailed: false,
    })
  },

  setOffline: () => {
    clearPersistedSessionId()
    set({ sessionId: null, isOnline: false, vehicleId: null, categoryId: null, mode: null, destinationCityName: null, activeRide: null, trackingFailed: false })
  },

  setActiveRide: (ride) => set({ activeRide: ride }),
  setTrackingFailed: (failed, sessionId) =>
    set((s) => ((sessionId !== undefined && s.sessionId !== sessionId) || (failed && !s.isOnline) ? s : { trackingFailed: failed })),
}))
