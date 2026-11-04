import { useIsFocused } from 'expo-router'
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import {
  WATCH_INTERVAL_MS,
  createLocationEngine,
  freshnessOf,
  getLastKnownFix,
  partializeLocation,
  toFix,
  track,
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
  /** Make sure the foreground watcher is running and re-arm the "still looking" timer. Cheap and idempotent. */
  refresh: () => void
  /** Wipe the saved location (sign-out / forced logout). */
  clearSaved: () => void
}

// The saved fix only seeds the next launch, and the watcher updates the store every few seconds: write at most once per
// PERSIST_DELAY_MS (latest value wins) instead of on every fix. Removing the key drops any write still waiting.
const PERSIST_DELAY_MS = 5000
let pendingWrite: string | null = null
let writeTimer: ReturnType<typeof setTimeout> | undefined
const throttledStorage = {
  getItem: (name: string) => AsyncStorage.getItem(name),
  setItem: (name: string, value: string) => {
    pendingWrite = value
    if (!writeTimer) {
      writeTimer = setTimeout(() => {
        writeTimer = undefined
        const v = pendingWrite
        pendingWrite = null
        if (v !== null) void AsyncStorage.setItem(name, v).catch(() => {})
      }, PERSIST_DELAY_MS)
    }
    return Promise.resolve()
  },
  removeItem: (name: string) => {
    pendingWrite = null
    clearTimeout(writeTimer)
    writeTimer = undefined
    return AsyncStorage.removeItem(name)
  },
}

export const useLocationStore = create<LocationState>()(
  persist(
    (set, get) => {
      // One foreground watcher feeds one value (see mobile-shared locationEngine). Everything stateful about fixes, the
      // address and the "still looking" cap lives there so it can be tested without React Native.
      const engine = createLocationEngine({
        get: () => get(),
        set: (patch) => set(patch),
        deps: {
          watch: (onFix, onError) =>
            Location.watchPositionAsync(
              { accuracy: Location.Accuracy.Balanced, timeInterval: WATCH_INTERVAL_MS, distanceInterval: 0 },
              (l) => onFix(toFix(l, 'gps')),
              onError // the engine restarts the watcher
            ),
          currentFix: () => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then((l) => toFix(l, 'gps')),
          lastKnown: getLastKnownFix,
          geocode: (lat, lng) => fetchReverseGeocode(lat, lng).then((d) => d.address),
          now: Date.now,
          track,
        },
      })

      const syncPermission = async (prompt: boolean): Promise<boolean> => {
        try {
          const res = prompt
            ? await Location.requestForegroundPermissionsAsync()
            : await Location.getForegroundPermissionsAsync()
          if (res.status === 'granted') {
            set({ permission: 'granted', permissionDenied: false })
            // Approximate-only permission gives fixes 1-2 km off: record it so we can tell that apart from a code bug.
            const level = res.android?.accuracy
            if (level) track('location_permission', { level })
            return true
          }
          set({ permission: prompt || res.status === 'denied' ? 'denied' : 'unknown', permissionDenied: prompt || res.status === 'denied', ready: true })
          return false
        } catch {
          set({ ready: true })
          return false
        }
      }

      // Foreground return: a full re-start (resets the "still looking" timer and the telemetry baseline).
      const startFresh = async () => {
        if (get().permission !== 'granted' && !(await syncPermission(false))) return
        await engine.activate()
      }

      // Screen focus: just make sure it is running.
      const start = () => {
        void (async () => {
          if (get().permission !== 'granted' && !(await syncPermission(false))) return
          await engine.ensure()
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
            // Registered before the first (possibly slow) activation so a quick background/foreground is never missed.
            // Watch only while the app is on screen: it keeps the pickup current and costs battery in the background.
            // iOS 'inactive' (permission dialog, notification shade, app switcher) is not a background: keep watching.
            AppState.addEventListener('change', (st) => {
              if (st === 'active') void startFresh()
              else if (st === 'background') engine.deactivate()
            })
            if (await syncPermission(true)) await engine.activate()
          })()
        },

        refresh: start,

        clearSaved: () => {
          engine.deactivate()
          engine.reset()
          set({ lat: null, lng: null, address: '', fixedAt: null, source: null, timedOut: false })
          void useLocationStore.persist.clearStorage()
        },
      }
    },
    {
      name: 'ocar_rider_location',
      version: 1,
      storage: createJSONStorage(() => throttledStorage),
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

/** One value for the home pill, ring dot, pulse, blue dot and the booking label (see freshnessOf). It re-reads the store
 *  instead of selecting fix fields, so the 5-second timestamp refreshes do not re-render the screen: only a change of
 *  freshness does. */
export function useFreshness(): Freshness {
  const compute = (): Freshness => {
    const { permission, lat, lng, fixedAt, source, timedOut } = useLocationStore.getState()
    const fix: Fix | null = lat === null || lng === null || fixedAt === null ? null : { lat, lng, fixedAt, source: source ?? 'cache' }
    return freshnessOf({ permission, fix, timedOut, now: Date.now() })
  }
  const [freshness, setFreshness] = useState<Freshness>(compute)
  // Home stays mounted under booking/ride screens; its ticker has no reason to run there.
  const focused = useIsFocused()
  useEffect(() => {
    const recompute = () => setFreshness(compute())
    recompute()
    if (!focused) return
    useLocationStore.getState().refresh() // coming back to a screen (e.g. after a ride) re-checks the watcher at once
    const unsub = useLocationStore.subscribe(recompute)
    const id = setInterval(recompute, 5_000) // the age buckets flip with time, not only with state
    return () => {
      unsub()
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compute only reads the store
  }, [focused])
  return freshness
}
