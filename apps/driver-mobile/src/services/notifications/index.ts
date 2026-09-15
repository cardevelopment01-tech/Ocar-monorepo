import * as Notifications from 'expo-notifications'
import { registerPushNotifications, unregisterPushNotifications } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/useAuthStore'

// TODO(fcm): google-services.json isn't available yet, so @react-native-firebase/messaging
// isn't installed (its Android build requires that file). Swap this for a real
// `() => messaging().getToken()` once the Firebase config lands -- nothing else here changes.
async function getFcmToken(): Promise<string | null> {
  return null
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
