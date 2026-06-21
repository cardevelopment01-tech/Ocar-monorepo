import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SessionState {
  isOnline: boolean
  sessionId: number | null
  vehicleId: number | null
  categoryId: number | null

  setOnline: (sessionId: number, vehicleId: number, categoryId: number) => void
  setOffline: () => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      isOnline:   false,
      sessionId:  null,
      vehicleId:  null,
      categoryId: null,

      setOnline: (sessionId, vehicleId, categoryId) =>
        set({ isOnline: true, sessionId, vehicleId, categoryId }),

      setOffline: () =>
        set({ isOnline: false, sessionId: null, vehicleId: null, categoryId: null }),
    }),
    { name: 'ocar_driver_session' }
  )
)
