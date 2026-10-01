import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import {
  FIX_TIMEOUT_MS,
  FRESH_MS,
  ageMs,
  freshnessOf,
  getFreshFix,
  getLastKnownFix,
  isFresh,
  movedBeyondGeocodeReuse,
  partializeLocation,
  pickBest,
  type Fix,
  type FixSource,
  type Freshness,
  type PermissionState,
} from '@ocar/mobile-shared'
import { fetchReverseGeocode } from '@/features/booking/api'

type LocationState = {
  // persisted (partializeLocation): the last fix and its street address
  lat: number | null
  lng: number | null
  address: string
  fixedAt: number | null
  // in-memory only. Never persist these: `initialized: true` on disk would make init() a no-op forever.
  source: FixSource | null
  permission: PermissionState
  timedOut: boolean
  hydrated: boolean
  /** First usable state reached: a saved/real fix exists, permission was denied, or the first attempt finished. */
  ready: boolean
  permissionDenied: boolean
  initialized: boolean
  /** Fire-and-forget, idempotent -- call once at app startup (root layout). */
  init: () => void
  /** Re-check permission and re-run the fix race; skipped while the last fix is under FRESH_MS old. */
  refresh: () => void
  /** Wipe the saved location (sign-out / forced logout). */
  clearSaved: () => void
}

export const useLocationStore = create<LocationState>()(
  persist(
    (set, get) => {
      let geocodeSeq = 0
      let capTimer: ReturnType<typeof setTimeout> | undefined

      const currentFix = (): Fix | null => {
        const { lat, lng, fixedAt, source } = get()
        return lat === null || lng === null || fixedAt === null ? null : { lat, lng, fixedAt, source: source ?? 'cache' }
      }

      // Newer fix wins (pickBest). The street address is reused inside 150 m and cleared beyond it, so a saved
      // street is never shown for a new place; only a real GPS fix triggers a reverse-geocode.
      const apply = (incoming: Fix | null) => {
        const prev = currentFix()
        const best = pickBest(prev, incoming, Date.now())
        if (!best || best === prev) return
        const moved = movedBeyondGeocodeReuse(prev, best)
        set({
          lat: best.lat,
          lng: best.lng,
          fixedAt: best.fixedAt,
          source: best.source,
          ready: true,
          ...(moved ? { address: '' } : {}),
          ...(isFresh(best, Date.now()) ? { timedOut: false } : {}),
        })
        if (best.source === 'gps' && (moved || !get().address)) {
          const seq = ++geocodeSeq
          fetchReverseGeocode(best.lat, best.lng)
            .then((d) => {
              if (seq === geocodeSeq) set({ address: d.address })
            })
            .catch(() => {
              // Coordinates alone are usable; the pill falls back to "Current location".
            })
        }
      }

      const syncPermission = async (prompt: boolean): Promise<boolean> => {
        try {
          const res = prompt
            ? await Location.requestForegroundPermissionsAsync()
            : await Location.getForegroundPermissionsAsync()
          if (res.status === 'granted') {
            set({ permission: 'granted', permissionDenied: false })
            return true
          }
          set({ permission: prompt || res.status === 'denied' ? 'denied' : 'unknown', permissionDenied: prompt || res.status === 'denied', ready: true })
          return false
        } catch {
          set({ ready: true })
          return false
        }
      }

      // `force` is true only for the launch call; a foreground return skips the work while the fix is still young.
      const run = (force: boolean) => {
        void (async () => {
          if (get().permission !== 'granted' && !(await syncPermission(false))) return
          const cur = currentFix()
          if (!force && cur && ageMs(cur.fixedAt, Date.now()) < FRESH_MS) return
          set({ timedOut: false })
          clearTimeout(capTimer)
          capTimer = setTimeout(() => {
            if (!isFresh(currentFix(), Date.now())) set({ timedOut: true })
          }, FIX_TIMEOUT_MS)
          void getLastKnownFix().then(apply)
          getFreshFix()
            .then(apply)
            .catch(() => set({ ready: true, timedOut: !isFresh(currentFix(), Date.now()) }))
            .finally(() => clearTimeout(capTimer))
        })()
      }

      return {
        lat: null,
        lng: null,
        address: '',
        fixedAt: null,
        source: null,
        permission: 'unknown',
        timedOut: false,
        hydrated: false,
        ready: false,
        permissionDenied: false,
        initialized: false,

        init: () => {
          if (get().initialized) return
          set({ initialized: true })
          void (async () => {
            // Wait for the persisted fix first: rehydration overwrites in-memory fields, so a fix that
            // arrived before it would be replaced by the older saved one.
            await whenHydrated()
            if (await syncPermission(true)) run(true)
            AppState.addEventListener('change', (s) => {
              if (s === 'active') run(false)
            })
          })()
        },

        refresh: () => run(false),

        clearSaved: () => {
          geocodeSeq++
          set({ lat: null, lng: null, address: '', fixedAt: null, source: null, timedOut: false })
          void useLocationStore.persist.clearStorage()
        },
      }
    },
    {
      name: 'ocar_rider_location',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: partializeLocation,
      onRehydrateStorage: () => (state, error) => {
        // Fail soft on a storage error: keep going with an empty cache (the splash cap covers slow reads too).
        useLocationStore.setState({
          hydrated: true,
          ...(!error && state?.lat != null && state.lng != null ? { source: 'cache' as const, ready: true } : {}),
        })
      },
    }
  )
)

function whenHydrated(): Promise<void> {
  return new Promise((resolve) => {
    if (useLocationStore.getState().hydrated) resolve()
    else {
      const unsub = useLocationStore.subscribe((s) => {
        if (s.hydrated) {
          unsub()
          resolve()
        }
      })
    }
  })
}

/** One value for the home pill, ring dot, pulse, blue dot and the booking label (see freshnessOf). */
export function useFreshness(): Freshness {
  const permission = useLocationStore((s) => s.permission)
  const lat = useLocationStore((s) => s.lat)
  const lng = useLocationStore((s) => s.lng)
  const fixedAt = useLocationStore((s) => s.fixedAt)
  const source = useLocationStore((s) => s.source)
  const timedOut = useLocationStore((s) => s.timedOut)

  const compute = (): Freshness => {
    const fix: Fix | null = lat === null || lng === null || fixedAt === null ? null : { lat, lng, fixedAt, source: source ?? 'cache' }
    return freshnessOf({ permission, fix, timedOut, now: Date.now() })
  }
  const [freshness, setFreshness] = useState<Freshness>(compute)
  useEffect(() => {
    setFreshness(compute())
    const id = setInterval(() => setFreshness(compute()), 15_000) // age buckets flip with time, not only with state
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compute closes over exactly these values
  }, [permission, lat, lng, fixedAt, source, timedOut])
  return freshness
}
