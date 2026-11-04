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
    // Best-effort -- a driver without a working FCM token still uses the app,
    // just without background push (in-app socket events still work while open).
    return null
  }
}

let stopTokenRefresh: (() => void) | null = null

export async function setupPushNotifications(opts: { prompt?: boolean } = {}): Promise<void> {
  const { granted } = await registerPushNotifications(api, {
    getFcmToken,
    prompt: opts.prompt ?? false,
    channels: [
      // _v2 -- forces Android to create a fresh channel with sound+vibrate baked
      // in (channel settings are locked after first creation and `adb install -r`
      // never resets them, only a full uninstall does; the original 'default'/
      // 'ride_requests' channels on already-installed devices were created before
      // that config existed).
      { channelId: 'default_v2', name: 'General' },
      // Heads-up (sound + banner) channel for ride lifecycle events. Android locks a channel's
      // importance at creation, so this is HIGH from the start.
      { channelId: 'ride_updates_v1', name: 'Ride updates', description: 'Rides assigned to you, added stops, pickup changes and cancellations', importance: Notifications.AndroidImportance.HIGH },
      { channelId: 'chat_v1', name: 'Messages', description: 'Messages from your rider', importance: Notifications.AndroidImportance.HIGH },
      { channelId: 'announcements_v1', name: 'Announcements', description: 'Notices from Ocar', importance: Notifications.AndroidImportance.DEFAULT },
      { channelId: 'account_alerts_v1', name: 'Account alerts', description: 'Document reviews and expiry, wallet balance, warnings and suspensions', importance: Notifications.AndroidImportance.HIGH },
      {
        channelId: 'ride_requests_v2',
        name: 'Ride requests',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 400, 200, 400],
      },
      // The loud one: a 22 s ring on the alarm volume (independent of the notification/ringer volume). The server sends
      // here only to devices registered with rideAlertV3; older builds keep using _v2. Android locks a channel's sound and
      // usage after creation, so any later change needs a _v4.
      {
        channelId: 'ride_requests_v3',
        name: 'Ride requests (loud)',
        description: 'Rings loudly when a new ride request arrives',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 600, 250, 600, 250, 600],
        sound: 'ride_request_long.wav',
        audioUsage: Notifications.AndroidAudioUsage.ALARM,
        lockscreenPublic: true,
      },
    ],
    deviceCapabilities: { rideAlertV3: true },
  })
  useAuthStore.getState().setPushPermissionGranted(granted)
  if (granted) {
    // FCM rotates tokens (reinstall, data clear, long idle); without this the server keeps the dead one.
    stopTokenRefresh?.()
    stopTokenRefresh = onTokenRefresh(getMessaging(getApp()), (token) => { registerDeviceToken(api, token, { rideAlertV3: true }).catch(() => {}) })
  }
}

// Runs BEFORE clearAuth (the DELETE needs the session token). Without a real token the old call
// was a no-op, so a logged-out phone kept receiving the previous driver's ride-request and chat pushes.
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
