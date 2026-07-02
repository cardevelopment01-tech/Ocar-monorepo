import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SessionState {
  isOnline: boolean
  sessionId: number | null
  vehicleId: number | null
  categoryId: number | null
  mode: 'standard' | 'return_cab' | null
  destinationCityName: string | null

  setOnline: (
    sessionId: number,
    vehicleId: number,
    categoryId: number,
    mode?: 'standard' | 'return_cab',
    destinationCityName?: string,
  ) => void
  setOffline: () => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      isOnline:            false,
      sessionId:           null,
      vehicleId:           null,
      categoryId:          null,
      mode:                null,
      destinationCityName: null,

      setOnline: (sessionId, vehicleId, categoryId, mode = 'standard', destinationCityName) =>
        set({ isOnline: true, sessionId, vehicleId, categoryId, mode, destinationCityName: destinationCityName ?? null }),

      setOffline: () =>
        set({ isOnline: false, sessionId: null, vehicleId: null, categoryId: null, mode: null, destinationCityName: null }),
    }),
    { name: 'ocar_driver_session' }
  )
)
