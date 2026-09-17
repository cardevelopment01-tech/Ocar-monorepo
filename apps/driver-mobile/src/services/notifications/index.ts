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
      { channelId: 'default', name: 'General' },
      {
        channelId: 'ride_requests',
        name: 'Ride requests',
        importance: Notifications.AndroidImportance.HIGH,
      },
    ],
  })
  useAuthStore.getState().setPushPermissionGranted(granted)
}

export async function teardownPushNotifications(): Promise<void> {
  await unregisterPushNotifications(api, null)
}
