import * as Notifications from 'expo-notifications'
import type { AxiosInstance } from 'axios'

export interface NotificationChannelConfig {
  channelId: string
  name: string
  importance?: Notifications.AndroidImportance
}

export interface PushNotificationsConfig {
  channels: NotificationChannelConfig[]
  // Injected rather than imported directly -- @react-native-firebase/messaging isn't
  // installed yet (needs google-services.json, not available as of this phase). Swap
  // in a real `() => messaging().getToken()` once the Firebase config file lands;
  // nothing else in this module changes.
  getFcmToken: () => Promise<string | null>
}

export async function registerPushNotifications(
  apiClient: AxiosInstance,
  config: PushNotificationsConfig
): Promise<{ granted: boolean }> {
  for (const channel of config.channels) {
    await Notifications.setNotificationChannelAsync(channel.channelId, {
      name: channel.name,
      importance: channel.importance ?? Notifications.AndroidImportance.DEFAULT,
    })
  }

  const { status } = await Notifications.requestPermissionsAsync()
  if (status !== 'granted') return { granted: false }

  const token = await config.getFcmToken()
  if (token) await apiClient.post('/api/v1/notifications/devices', { token, platform: 'android' })

  return { granted: true }
}

export async function unregisterPushNotifications(apiClient: AxiosInstance, token: string | null): Promise<void> {
  if (!token) return
  try {
    await apiClient.delete('/api/v1/notifications/devices', { data: { token } })
  } catch {
    // Best-effort -- logout must not block on this.
  }
}
