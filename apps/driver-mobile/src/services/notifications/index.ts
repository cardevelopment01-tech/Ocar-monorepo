import * as Notifications from 'expo-notifications'
import { getApp } from '@react-native-firebase/app'
import { getMessaging, getToken, requestPermission, AuthorizationStatus } from '@react-native-firebase/messaging'
import { registerPushNotifications, unregisterPushNotifications } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/useAuthStore'

async function getFcmToken(): Promise<string | null> {
  try {
    const messaging = getMessaging(getApp())
    const authStatus = await requestPermission(messaging)
    const authorized =
      authStatus === AuthorizationStatus.AUTHORIZED || authStatus === AuthorizationStatus.PROVISIONAL
    if (!authorized) return null
    return await getToken(messaging)
  } catch {
    // Best-effort -- a driver without a working FCM token still uses the app,
    // just without background push (in-app socket events still work while open).
    return null
  }
}

export async function setupPushNotifications(): Promise<void> {
  const { granted } = await registerPushNotifications(api, {
    getFcmToken,
    channels: [
      // _v2 -- forces Android to create a fresh channel with sound+vibrate baked
      // in (channel settings are locked after first creation and `adb install -r`
      // never resets them, only a full uninstall does; the original 'default'/
      // 'ride_requests' channels on already-installed devices were created before
      // that config existed).
      { channelId: 'default_v2', name: 'General' },
      {
        channelId: 'ride_requests_v2',
        name: 'Ride requests',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 400, 200, 400],
      },
    ],
  })
  useAuthStore.getState().setPushPermissionGranted(granted)
}

export async function teardownPushNotifications(): Promise<void> {
  await unregisterPushNotifications(api, null)
}
