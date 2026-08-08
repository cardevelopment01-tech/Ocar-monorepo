'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { geoApi } from './geo-api'

type Fix = { lat: number; lng: number }

type LocationState = {
  lat: number | null
  lng: number | null
  address: string
  cityId: number | null
  gpsReady: boolean
  isStale: boolean
  refresh: () => Promise<Fix | null>
  ensureFresh: () => Promise<Fix | null>
}

// How long a cached fix is trusted before a booking action re-checks it.
// Long enough to avoid re-fetching on every tap; short enough that "opened
// the app, came back 10 minutes later" gets a real position, not the one
// from when the tab first loaded.
const STALE_AFTER_MS = 2 * 60 * 1000

const INITIAL = { lat: null, lng: null, address: '', cityId: null, gpsReady: false }

const LocationContext = createContext<LocationState>({
  ...INITIAL,
  isStale: true,
  refresh: async () => null,
  ensureFresh: async () => null,
})

// Requests GPS once, as early as the app can run JS (root layout, before any
// page mounts) so it has the whole splash-screen + first-navigation window to
// resolve instead of racing a page's own render. Every page reads the same
// result instead of each firing its own getCurrentPosition().
export function LocationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<LocationState, 'isStale' | 'refresh' | 'ensureFresh'>>(INITIAL)
  const fetchedAtRef = useRef<number | null>(null)
  const inFlightRef  = useRef<Promise<Fix | null> | null>(null)

  const fetchFix = useCallback((): Promise<Fix | null> => {
    if (inFlightRef.current) return inFlightRef.current
    const p = new Promise<Fix | null>(resolve => {
      if (!navigator.geolocation) {
        fetchedAtRef.current = Date.now()
        setState(s => ({ ...s, gpsReady: true }))
        resolve(null)
        return
      }
      navigator.geolocation.getCurrentPosition(
        pos => {
          const { latitude, longitude } = pos.coords
          fetchedAtRef.current = Date.now()
          setState(s => ({ ...s, lat: latitude, lng: longitude, gpsReady: true }))
          geoApi.reverseGeocode(latitude, longitude)
            .then(address => setState(s => ({ ...s, address })))
            .catch(() => setState(s => ({ ...s, address: 'Current location' })))
          geoApi.findNearestCity(latitude, longitude)
            .then(city => setState(s => ({ ...s, cityId: city.id })))
            .catch(() => {})
          resolve({ lat: latitude, lng: longitude })
        },
        () => {
          fetchedAtRef.current = Date.now()
          setState(s => ({ ...s, gpsReady: true }))
          resolve(null)
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
      )
    }).finally(() => { inFlightRef.current = null })
    inFlightRef.current = p
    return p
  }, [])

  useEffect(() => { void fetchFix() }, [fetchFix])

  const isStale = fetchedAtRef.current === null || Date.now() - fetchedAtRef.current > STALE_AFTER_MS

  const ensureFresh = useCallback((): Promise<Fix | null> => {
    if (fetchedAtRef.current !== null && Date.now() - fetchedAtRef.current <= STALE_AFTER_MS) {
      return Promise.resolve(state.lat !== null && state.lng !== null ? { lat: state.lat, lng: state.lng } : null)
    }
    return fetchFix()
  }, [fetchFix, state.lat, state.lng])

  // App was backgrounded/idle and the tab regains focus — if the cached fix
  // is stale, refresh it in the background so the next screen the user
  // lands on already has a current position instead of one from whenever
  // the tab first opened.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      const stale = fetchedAtRef.current === null || Date.now() - fetchedAtRef.current > STALE_AFTER_MS
      if (stale) void fetchFix()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [fetchFix])

  return (
    <LocationContext.Provider value={{ ...state, isStale, refresh: fetchFix, ensureFresh }}>
      {children}
    </LocationContext.Provider>
  )
}

export function useLocation() {
  return useContext(LocationContext)
}
