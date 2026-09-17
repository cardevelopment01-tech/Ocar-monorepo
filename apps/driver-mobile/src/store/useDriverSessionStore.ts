import { create } from 'zustand'

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
  activeRide: ActiveRideSummary | null
  setOnline: (session: { id: string; vehicleId: number; categoryId: number }) => void
  setOffline: () => void
  setActiveRide: (ride: ActiveRideSummary | null) => void
}

export const useDriverSessionStore = create<DriverSessionState>()((set) => ({
  sessionId: null,
  isOnline: false,
  vehicleId: null,
  categoryId: null,
  activeRide: null,

  setOnline: (session) =>
    set({
      sessionId: session.id,
      isOnline: true,
      vehicleId: session.vehicleId,
      categoryId: session.categoryId,
    }),

  setOffline: () =>
    set({ sessionId: null, isOnline: false, vehicleId: null, categoryId: null, activeRide: null }),

  setActiveRide: (ride) => set({ activeRide: ride }),
}))
