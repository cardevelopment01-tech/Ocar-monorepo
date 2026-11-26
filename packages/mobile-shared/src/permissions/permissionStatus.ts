import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { statusFromNotificationPermission, type PermissionStatus } from './permissionRules'

// Reads what the phone says right now. Kept apart from permissionRules.ts so the pure rules can be unit-tested without native modules.
export async function readNotificationStatus(): Promise<PermissionStatus> {
  try {
    return statusFromNotificationPermission(await Notifications.getPermissionsAsync(), Platform.OS === 'android' ? Number(Platform.Version) : undefined)
  } catch {
    return 'ask'
  }
}

/** Foreground ("while using the app") location. */
export async function readLocationStatus(): Promise<PermissionStatus> {
  try {
    const p = await Location.getForegroundPermissionsAsync()
    if (p.granted) return 'granted'
    return p.canAskAgain ? 'ask' : 'blocked'
  } catch {
    return 'ask'
  }
}

/** Background ("all the time") location, which Android only offers once foreground location is on. */
export async function readBackgroundLocationGranted(): Promise<boolean> {
  try {
    return (await Location.getBackgroundPermissionsAsync()).granted
  } catch {
    return false
  }
}
