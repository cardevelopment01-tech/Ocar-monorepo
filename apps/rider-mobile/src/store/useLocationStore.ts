import { create } from 'zustand'
import * as Location from 'expo-location'
import { getCurrentOrLastKnownPosition } from '@ocar/mobile-shared'
import { fetchReverseGeocode } from '@/features/booking/api'

type LocationState = {
  lat: number | null
  lng: number | null
  address: string
  ready: boolean
  permissionDenied: boolean
  initialized: boolean
  /** Fire-and-forget, idempotent -- call once at app startup (root layout) so
   *  the GPS fix + reverse-geocode is already in flight (often already resolved)
   *  by the time the search screen mounts, instead of starting cold there and
   *  making the rider wait on "Finding your location…" every time. */
  init: () => void
}

export const useLocationStore = create<LocationState>((set, get) => ({
  lat: null,
  lng: null,
  address: '',
  ready: false,
  permissionDenied: false,
  initialized: false,

  init: () => {
    if (get().initialized) return
    set({ initialized: true })
    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== 'granted') {
          set({ ready: true, permissionDenied: true })
          return
        }
        const position = await getCurrentOrLastKnownPosition()
        set({ lat: position.coords.latitude, lng: position.coords.longitude, ready: true })
        try {
          const detail = await fetchReverseGeocode(position.coords.latitude, position.coords.longitude)
          set({ address: detail.address })
        } catch {
          // Coordinates alone are still usable for booking -- a missing
          // street address just falls back to the "Current Location" label.
        }
      } catch {
        set({ ready: true })
      }
    })()
  },
}))
