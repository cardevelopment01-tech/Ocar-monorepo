import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import type { AxiosInstance } from 'axios'

export interface NotificationChannelConfig {
  channelId: string
  name: string
  // Shown under the channel name in Android's notification settings.
  description?: string
  importance?: Notifications.AndroidImportance
  vibrationPattern?: number[]
}

export interface PushNotificationsConfig {
  channels: NotificationChannelConfig[]
  // Injected rather than imported directly -- @react-native-firebase/messaging isn't
  // installed yet (needs google-services.json, not available as of this phase). Swap
  // in a real `() => messaging().getToken()` once the Firebase config file lands;
  // nothing else in this module changes.
  getFcmToken: () => Promise<string | null>
  // true = show the system permission dialog if the user hasn't decided yet. Left false for the
  // silent re-registration done on every launch; only an explicit user action (the primer sheet,
  // a "Turn on" button) should prompt.
  prompt?: boolean
}

export async function registerPushNotifications(
  apiClient: AxiosInstance,
  config: PushNotificationsConfig
): Promise<{ granted: boolean }> {
  // sound/enableVibrate/vibrationPattern were previously left unset -- Android's
  // NotificationChannel defaults enableVibrate to FALSE (sound-only), and FCM
  // pushes never referenced a channelId at all (see push.provider.ts), so they
  // fell into Android's own silent-ish auto-created fallback channel instead of
  // any channel this app configured. Both are fixed now: every channel this app
  // creates explicitly gets sound + vibration, and the backend now targets
  // these channelIds directly.
  for (const channel of config.channels) {
    await Notifications.setNotificationChannelAsync(channel.channelId, {
      name: channel.name,
      ...(channel.description !== undefined ? { description: channel.description } : {}),
      importance: channel.importance ?? Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
      enableVibrate: true,
      vibrationPattern: channel.vibrationPattern ?? [0, 250, 250, 250],
    })
  }

  let granted = (await Notifications.getPermissionsAsync()).granted
  if (!granted && config.prompt) granted = (await Notifications.requestPermissionsAsync()).granted
  if (!granted) return { granted: false }

  const token = await config.getFcmToken()
  if (token) await registerDeviceToken(apiClient, token)

  return { granted: true }
}

// Also called when FCM rotates the token, otherwise the server keeps pushing to a dead one.
export async function registerDeviceToken(apiClient: AxiosInstance, token: string): Promise<void> {
  await apiClient.post('/api/v1/notifications/devices', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' })
}

export async function unregisterPushNotifications(apiClient: AxiosInstance, token: string | null): Promise<void> {
  if (!token) return
  try {
    await apiClient.delete('/api/v1/notifications/devices', { data: { token } })
  } catch {
    // Best-effort -- logout must not block on this.
  }
}
