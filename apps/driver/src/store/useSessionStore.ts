import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SessionState {
  isOnline: boolean
  sessionId: number | null
  vehicleId: number | null
  categoryId: number | null
  mode: 'standard' | 'return_cab' | null
  destinationCityName: string | null

  // Last-known today's earnings, persisted so the Home header chip renders the
  // real value instantly on (re)mount instead of flashing ₹0 — Home unmounts
  // during a ride, so without this the count-up would roll from zero on every
  // return. Deliberately NOT cleared by setOffline: money earned today stays
  // visible when the driver goes offline.
  earningsToday: number
  tripsToday: number
  setEarnings: (total: number, trips: number) => void

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
      earningsToday:       0,
      tripsToday:          0,

      setEarnings: (total, trips) => set({ earningsToday: total, tripsToday: trips }),

      setOnline: (sessionId, vehicleId, categoryId, mode = 'standard', destinationCityName) =>
        set({ isOnline: true, sessionId, vehicleId, categoryId, mode, destinationCityName: destinationCityName ?? null }),

      setOffline: () =>
        set({ isOnline: false, sessionId: null, vehicleId: null, categoryId: null, mode: null, destinationCityName: null }),
    }),
    { name: 'ocar_driver_session' }
  )
)
