import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import { emitLocationTick } from './locationSync'
import { useDriverPositionStore } from './driverPositionStore'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { isAccurateEnough, trackingProfileForRideState } from './locationPolicy'

export const LOCATION_TASK_NAME = 'ocar-background-location-spike'

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
  } catch {
    // A background task nothing awaits or catches must never throw.
  }
})

let unsubscribeActiveRide: (() => void) | null = null
let currentProfileKey: string | null = null

function taskOptions(hasActiveRide: boolean): Location.LocationTaskOptions {
  const { intervalMs, distanceMeters, highAccuracy } = trackingProfileForRideState(hasActiveRide)
  return {
    accuracy: highAccuracy ? Location.Accuracy.High : Location.Accuracy.Balanced,
    timeInterval: intervalMs,
    distanceInterval: distanceMeters,
    foregroundService: {
      notificationTitle: 'Ocar is tracking your location',
      notificationBody: "Required while you're online to receive ride requests.",
    },
  }
}

// Claim the profile BEFORE the first await so two quick store changes can't both call
// startLocationUpdatesAsync; roll back if the call fails so a later change retries.
async function applyProfile(hasActiveRide: boolean): Promise<void> {
  const key = hasActiveRide ? 'active' : 'idle'
  if (currentProfileKey === key) return
  const previous = currentProfileKey
  currentProfileKey = key
  try {
    if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME))) {
      currentProfileKey = previous
      return
    }
    // expo-location updates an already-running task's options in place when
    // startLocationUpdatesAsync is called again with the same task name --
    // no stop/start flicker, no gap in coverage.
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, taskOptions(hasActiveRide))
  } catch {
    currentProfileKey = previous
  }
}

// Idempotent: (re)arms the idle <-> active-ride switch. Needed on its own because a cold
// relaunch restores the running task but not this module-level subscription.
export function ensureRideIntervalSubscription(): void {
  if (unsubscribeActiveRide) return
  let hadRide = !!useDriverSessionStore.getState().activeRide
  unsubscribeActiveRide = useDriverSessionStore.subscribe((state) => {
    const hasRide = !!state.activeRide
    if (hasRide === hadRide) return
    hadRide = hasRide
    void applyProfile(hasRide)
  })
  // Pick up a ride that was already active when tracking (re)started (e.g. app
  // relaunch mid-ride), not just the next status change.
  if (hadRide) void applyProfile(true)
}

export async function startBackgroundTracking(): Promise<void> {
  const hasRide = !!useDriverSessionStore.getState().activeRide
  currentProfileKey = hasRide ? 'active' : 'idle'
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, taskOptions(hasRide))
  ensureRideIntervalSubscription()
}

// For an online driver after a process restart: re-creates the task if the OS dropped it,
// otherwise just re-arms the idle <-> ride switch that the restart wiped out.
export async function ensureBackgroundTracking(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) ensureRideIntervalSubscription()
  else await startBackgroundTracking()
}

export async function stopBackgroundTracking(): Promise<void> {
  unsubscribeActiveRide?.()
  unsubscribeActiveRide = null
  currentProfileKey = null
  const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
  if (isTracking) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME)
}

export async function isCurrentlyTracking(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
}
