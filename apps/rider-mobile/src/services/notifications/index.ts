import * as Notifications from 'expo-notifications'
import { getApp } from '@react-native-firebase/app'
import { getMessaging, getToken, deleteToken, onTokenRefresh, requestPermission, AuthorizationStatus } from '@react-native-firebase/messaging'
import { registerDeviceToken, registerPushNotifications, unregisterPushNotifications } from '@ocar/mobile-shared'
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
    // Best-effort -- a rider without a working FCM token still uses the app,
    // just without background push.
    return null
  }
}

let stopTokenRefresh: (() => void) | null = null

export async function setupPushNotifications(): Promise<void> {
  const { granted } = await registerPushNotifications(api, {
    getFcmToken,
    // _v2 -- forces a fresh channel with sound+vibrate (see driver-mobile's
    // notifications/index.ts comment for why the plain 'default' id is stuck).
    channels: [
      { channelId: 'default_v2', name: 'General' },
      // Heads-up (sound + banner) channel for ride lifecycle events (driver arrived, cancelled, ...).
      // Android locks a channel's importance at creation, so this is HIGH from the start.
      { channelId: 'ride_updates_v1', name: 'Ride updates', description: 'Driver on the way, arrived, trip started and completed, cancellations, payment problems', importance: Notifications.AndroidImportance.HIGH },
      { channelId: 'chat_v1', name: 'Messages', description: 'Messages from your driver', importance: Notifications.AndroidImportance.HIGH },
    ],
  })
  useAuthStore.getState().setPushPermissionGranted(granted)
  if (granted) {
    // FCM rotates tokens (reinstall, data clear, long idle); without this the server keeps the dead one.
    stopTokenRefresh?.()
    stopTokenRefresh = onTokenRefresh(getMessaging(getApp()), (token) => { registerDeviceToken(api, token).catch(() => {}) })
  }
}

// Runs BEFORE clearAuth (the DELETE needs the session token). Passing null was a no-op, so a
// logged-out phone kept receiving the previous rider's ride-update and chat pushes.
export async function teardownPushNotifications(): Promise<void> {
  stopTokenRefresh?.()
  stopTokenRefresh = null
  try {
    const messaging = getMessaging(getApp())
    const token = await getToken(messaging)
    await unregisterPushNotifications(api, token)
    await deleteToken(messaging)
  } catch {
    // Best-effort -- logout must not block on FCM.
  }
}
