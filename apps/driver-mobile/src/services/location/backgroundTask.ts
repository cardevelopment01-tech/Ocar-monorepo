import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { emitLocationTick } from './locationSync'
import { useDriverPositionStore } from './driverPositionStore'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { IDLE_INTERVAL_MS, intervalForRideState, isAccurateEnough } from './locationPolicy'

// Dev-only verification log, kept from the Day 5 spike for manual on-device
// verification (__DEV__-gated in useLocationSpikeTest.ts) -- separate from the
// real backend sync below. Capped at 50 entries.
const LOG_KEY = 'ocar_location_spike_log'
const MAX_LOG_ENTRIES = 50

export const LOCATION_TASK_NAME = 'ocar-background-location-spike'

interface LoggedFix {
  lat: number
  lng: number
  timestamp: number
}

// Must be called at module scope (not inside a component or conditionally) --
// Android can invoke this task in a headless JS instance after the app process
// was killed, so the task definition has to already exist when that happens.
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) return
  try {
    const { locations } = (data as { locations: Location.LocationObject[] }) ?? { locations: [] }
    const latest = locations[locations.length - 1]
    if (!latest) return
    if (!isAccurateEnough(latest.coords.accuracy)) return

    // Real backend sync (Days 8-10) -- no-ops if the driver isn't online
    // (emitLocationTick reads the current sessionId itself).
    void emitLocationTick({
      lat: latest.coords.latitude,
      lng: latest.coords.longitude,
      ...(latest.coords.heading != null ? { heading: latest.coords.heading } : {}),
      ...(latest.coords.speed != null ? { speed: latest.coords.speed } : {}),
      recordedAt: new Date(latest.timestamp).toISOString(),
    })
    useDriverPositionStore.getState().setPosition({
      lat: latest.coords.latitude,
      lng: latest.coords.longitude,
      ...(latest.coords.heading != null ? { heading: latest.coords.heading } : {}),
      ...(latest.coords.speed != null ? { speed: latest.coords.speed } : {}),
    })
    useDriverPositionStore.getState().startStaleWatch()

    // ponytail: unlocked read-modify-write -- burst delivery can race and drop an
    // entry. Fine for a capped, throwaway dev verification log.
    const raw = await AsyncStorage.getItem(LOG_KEY)
    const log: LoggedFix[] = raw ? JSON.parse(raw) : []
    log.push({ lat: latest.coords.latitude, lng: latest.coords.longitude, timestamp: latest.timestamp })
    await AsyncStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-MAX_LOG_ENTRIES)))
  } catch {
    // Best-effort verification log -- a corrupted/foreign value under LOG_KEY
    // shouldn't crash a background task nothing awaits or catches.
  }
})

export async function getLoggedFixes(): Promise<LoggedFix[]> {
  const raw = await AsyncStorage.getItem(LOG_KEY)
  return raw ? JSON.parse(raw) : []
}

export async function clearLoggedFixes(): Promise<void> {
  await AsyncStorage.removeItem(LOG_KEY)
}

let unsubscribeActiveRide: (() => void) | null = null
let currentIntervalMs: number | null = null

async function applyInterval(intervalMs: number): Promise<void> {
  if (currentIntervalMs === intervalMs) return
  const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
  if (!isTracking) return
  currentIntervalMs = intervalMs
  // expo-location updates an already-running task's options in place when
  // startLocationUpdatesAsync is called again with the same task name --
  // no stop/start flicker, no gap in coverage.
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: intervalMs,
    distanceInterval: 0,
    foregroundService: {
      notificationTitle: 'Ocar is tracking your location',
      notificationBody: "Required while you're online to receive ride requests.",
    },
  })
}

export async function startBackgroundTracking(): Promise<void> {
  currentIntervalMs = IDLE_INTERVAL_MS
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: IDLE_INTERVAL_MS,
    distanceInterval: 0,
    foregroundService: {
      notificationTitle: 'Ocar is tracking your location',
      notificationBody: "Required while you're online to receive ride requests.",
    },
  })

  unsubscribeActiveRide?.()
  unsubscribeActiveRide = useDriverSessionStore.subscribe((state) => {
    void applyInterval(intervalForRideState(!!state.activeRide))
  })
  // Pick up a ride that was already active when tracking (re)started (e.g. app
  // relaunch mid-ride), not just the next status change.
  if (useDriverSessionStore.getState().activeRide) void applyInterval(intervalForRideState(true))
}

export async function stopBackgroundTracking(): Promise<void> {
  unsubscribeActiveRide?.()
  unsubscribeActiveRide = null
  currentIntervalMs = null
  const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
  if (isTracking) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME)
}

export async function isCurrentlyTracking(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
}
