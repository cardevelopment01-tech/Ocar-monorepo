import { useIsFocused } from 'expo-router'
import { useEffect, useReducer, useRef } from 'react'
import { AppState } from 'react-native'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import {
  WATCH_INTERVAL_MS,
  createLocationEngine,
  freshnessOf,
  isApproximate,
  getLastKnownFix,
  partializeLocation,
  toFix,
  track,
  type Fix,
  type FixSource,
  type PermissionLevel,
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
  /** Android: did the rider grant precise (fine) or approximate (coarse) location. In memory only. */
  permissionLevel: PermissionLevel
  accuracy: number | null
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
  /** A screen that needs a current location is on show: keep the watcher running until every holder has released. */
  acquire: (precise?: boolean) => void
  release: (precise?: boolean) => void
  /** Wipe the saved location (sign-out / forced logout). */
  clearSaved: () => void
}

// The saved fix only seeds the next launch, and the watcher updates the store every few seconds: write at most once per
// PERSIST_DELAY_MS (latest value wins) instead of on every fix. Removing the key drops any write still waiting.
const PERSIST_DELAY_MS = 5000
let pendingWrite: string | null = null
let pendingName = ''
let writeTimer: ReturnType<typeof setTimeout> | undefined
/** Write what is waiting now (the app is going to the background, where the timer may never fire). */
function flushPendingWrite() {
  clearTimeout(writeTimer)
  writeTimer = undefined
  const v = pendingWrite
  pendingWrite = null
  if (v !== null) void AsyncStorage.setItem(pendingName, v).catch(() => {})
}
const throttledStorage = {
  getItem: (name: string) => AsyncStorage.getItem(name),
  setItem: (name: string, value: string) => {
    pendingWrite = value
    pendingName = name
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
      let askedSettings = false
      let releaseTimer: ReturnType<typeof setTimeout> | undefined
      let preciseConsumers = 0 // of those, the ones placing a pickup: they want GPS-grade accuracy
      let preciseTimer: ReturnType<typeof setTimeout> | undefined
      let consumers = 0 // screens that currently need a live location (home, booking, map picker, ride's pickup editor)
      let appActive = true
      let wasBackground = false
      let launchHold = false // the first minute after launch tracks regardless, so the first fix is not waiting on a screen

      const engine = createLocationEngine({
        get: () => get(),
        set: (patch) => set(patch),
        deps: {
          watch: (onFix, onError, precise) =>
            Location.watchPositionAsync(
              { accuracy: precise ? Location.Accuracy.High : Location.Accuracy.Balanced, timeInterval: WATCH_INTERVAL_MS, distanceInterval: 0, mayShowUserSettingsDialog: false },
              (l) => onFix(toFix(l, 'gps')),
              onError // the engine restarts the watcher
            ),
          // The system "turn on location" dialog may appear once per launch (on the first direct request); automatic
          // retries must never re-prompt a rider who said no.
          currentFix: () => {
            const mayShow = !askedSettings
            askedSettings = true
            return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced, mayShowUserSettingsDialog: mayShow }).then((l) => toFix(l, 'gps'))
          },
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
            if (level) {
              track('location_permission', { level })
              set({ permissionLevel: level === 'coarse' ? 'coarse' : 'fine' })
            }
            return true
          }
          set({ permission: prompt || res.status === 'denied' ? 'denied' : 'unknown', permissionDenied: prompt || res.status === 'denied', ready: true })
          return false
        } catch {
          set({ ready: true })
          return false
        }
      }

      // Foreground return: re-read the permission (the rider may have just switched on Precise in Settings) and re-start.
      const startFresh = async () => {
        if (!(await syncPermission(false))) {
          engine.deactivate()
          return
        }
        await engine.activate()
      }

      // Screen focus: just make sure it is running.
      const start = () => {
        void (async () => {
          // A live fix must not be overwritten by the saved one arriving late from storage.
          await whenHydrated()
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
        permissionLevel: 'unknown',
        accuracy: null,
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
              if (st === 'background') {
                appActive = false
                wasBackground = true
                flushPendingWrite()
                engine.deactivate()
              } else if (st === 'active' && wasBackground) {
                // Only a real return from the background restarts: 'inactive' -> 'active' (system dialog, shade) does not.
                wasBackground = false
                appActive = true
                if (consumers > 0 || launchHold) void startFresh()
              }
            })
            launchHold = true
            setTimeout(() => {
              launchHold = false
              if (consumers === 0) engine.deactivate()
            }, 60_000)
            if (await syncPermission(true)) await engine.activate()
          })()
        },

        refresh: start,

        acquire: (precise = false) => {
          clearTimeout(releaseTimer)
          consumers++
          if (precise) {
            preciseConsumers++
            clearTimeout(preciseTimer)
            engine.setPrecise(true)
          }
          if (appActive) start()
        },

        release: (precise = false) => {
          consumers = Math.max(0, consumers - 1)
          if (precise) {
            preciseConsumers = Math.max(0, preciseConsumers - 1)
            // Pickup search -> map picker releases one a moment before the next acquires: do not restart the watcher in between.
            if (preciseConsumers === 0) {
              clearTimeout(preciseTimer)
              preciseTimer = setTimeout(() => { if (preciseConsumers === 0) engine.setPrecise(false) }, 2_000)
            }
          }
          // Moving between screens releases one a moment before the next acquires: do not tear the watcher down in between.
          if (consumers === 0 && !launchHold) {
            clearTimeout(releaseTimer)
            releaseTimer = setTimeout(() => {
              if (consumers === 0 && !launchHold) engine.deactivate()
            }, 2_000)
          }
        },

        clearSaved: () => {
          engine.deactivate()
          engine.reset()
          set({ lat: null, lng: null, address: '', fixedAt: null, source: null, accuracy: null, timedOut: false })
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

/** Keep the location watcher running while the calling screen is on show (and `enabled`). Nothing else starts it for long:
 *  the ride-tracking screen, for instance, does not hold it, so a trip does not poll GPS or the geocoder for hours. */
export function useLocationTracking(enabled = true, precise = false): void {
  const focused = useIsFocused()
  useEffect(() => {
    if (!enabled || !focused) return
    const { acquire, release } = useLocationStore.getState()
    acquire(precise)
    return () => release(precise)
  }, [enabled, focused, precise])
}

/** One value for the home pill, ring dot, pulse, blue dot and the booking label (see freshnessOf). Computed on every
 *  render from the store (so a render after a long pause never shows a stale "live"), and re-rendered only when the
 *  value flips: the 5-second timestamp refreshes do not re-render the screen. */
export function useFreshness(): Freshness {
  const compute = (): Freshness => {
    const { permission, lat, lng, fixedAt, source, timedOut } = useLocationStore.getState()
    const fix: Fix | null = lat === null || lng === null || fixedAt === null ? null : { lat, lng, fixedAt, source: source ?? 'cache' }
    return freshnessOf({ permission, fix, timedOut, now: Date.now() })
  }
  const value = compute()
  const shown = useRef(value)
  shown.current = value
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const focused = useIsFocused()
  useEffect(() => {
    if (!focused) return
    const check = () => { if (compute() !== shown.current) rerender() }
    check()
    const unsub = useLocationStore.subscribe(check)
    const id = setInterval(check, 5_000) // the age buckets flip with time, not only with state
    return () => {
      unsub()
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compute only reads the store
  }, [focused])
  return value
}

/** True when the location we are getting is approximate (approximate-only permission, or a fix too rough for a pickup).
 *  A boolean selector, so it re-renders only when it flips. */
export function useApproximateLocation(): boolean {
  return useLocationStore((s) => s.permission === 'granted' && isApproximate(s.permissionLevel, s.accuracy))
}

/** Approximate-only permission (Android): the one case where the rider can fix it in Settings, so the only one we say so for. */
export function useNeedsPreciseToggle(): boolean {
  return useLocationStore((s) => s.permission === 'granted' && s.permissionLevel === 'coarse')
}
