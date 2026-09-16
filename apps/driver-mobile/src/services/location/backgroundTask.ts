import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import AsyncStorage from '@react-native-async-storage/async-storage'

// Spike-only verification log -- NOT the real backend sync (that's Days 9-10's
// POST /api/v1/rides/sessions/location, which needs a real session id from the
// online/offline flow that doesn't exist yet). Capped at 50 entries.
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
  const { locations } = (data as { locations: Location.LocationObject[] }) ?? { locations: [] }
  const latest = locations[locations.length - 1]
  if (!latest) return

  const raw = await AsyncStorage.getItem(LOG_KEY)
  const log: LoggedFix[] = raw ? JSON.parse(raw) : []
  log.push({ lat: latest.coords.latitude, lng: latest.coords.longitude, timestamp: latest.timestamp })
  await AsyncStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-MAX_LOG_ENTRIES)))
})

export async function getLoggedFixes(): Promise<LoggedFix[]> {
  const raw = await AsyncStorage.getItem(LOG_KEY)
  return raw ? JSON.parse(raw) : []
}

export async function clearLoggedFixes(): Promise<void> {
  await AsyncStorage.removeItem(LOG_KEY)
}

export async function startBackgroundTracking(): Promise<void> {
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 5000,
    distanceInterval: 0,
    foregroundService: {
      notificationTitle: 'Ocar is tracking your location',
      notificationBody: "Required while you're online to receive ride requests.",
    },
  })
}

export async function stopBackgroundTracking(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME)
  if (isRegistered) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME)
}
