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
  // A bundled sound file (e.g. 'ride_request_long.wav', listed in the expo-notifications plugin `sounds`). Default: the system sound.
  sound?: string
  // Which Android volume the sound plays on. ALARM is independent of the notification/ringer volume and is normally louder.
  audioUsage?: Notifications.AndroidAudioUsage
  // Show the full text on the lock screen even when the phone hides sensitive content. Opt-in: only for alerts the driver
  // must read at a glance (ride requests), never for channels that can carry OTPs or personal details.
  lockscreenPublic?: boolean
  // No sound and no vibration (a channel that only replaces or updates another alert).
  silent?: boolean
}

export interface DeviceCapabilities {
  /** This build created the loud 'ride_requests_v3' channel. */
  rideAlertV3?: boolean
}

export interface PushNotificationsConfig {
  channels: NotificationChannelConfig[]
  // Injected rather than imported directly -- @react-native-firebase/messaging isn't
  // installed yet (needs google-services.json, not available as of this phase). Swap
  // in a real `() => messaging().getToken()` once the Firebase config file lands;
  // nothing else in this module changes.
  getFcmToken: () => Promise<string | null>
  // Sent with the device token so the server can pick the right notification channel per device.
  // A function gets the ids of the channels that were created this launch, so a capability is claimed only when its channel exists.
  deviceCapabilities?: DeviceCapabilities | ((createdChannels: Set<string>) => DeviceCapabilities)
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
  const created = new Set<string>()
  for (const channel of config.channels) {
    try {
      await Notifications.setNotificationChannelAsync(channel.channelId, {
        name: channel.name,
        ...(channel.description !== undefined ? { description: channel.description } : {}),
        importance: channel.importance ?? Notifications.AndroidImportance.DEFAULT,
        sound: channel.silent ? null : (channel.sound ?? 'default'),
        enableVibrate: !channel.silent,
        ...(channel.silent ? {} : { vibrationPattern: channel.vibrationPattern ?? [0, 250, 250, 250] }),
        ...(channel.audioUsage !== undefined
          ? { audioAttributes: { usage: channel.audioUsage, contentType: Notifications.AndroidAudioContentType.SONIFICATION } }
          : {}),
        ...(channel.lockscreenPublic ? { lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC } : {}),
      })
      created.add(channel.channelId)
    } catch {
      // One bad channel must not stop the rest, or the push token registration below.
    }
  }

  let granted = (await Notifications.getPermissionsAsync()).granted
  if (!granted && config.prompt) granted = (await Notifications.requestPermissionsAsync()).granted
  if (!granted) return { granted: false }

  const token = await config.getFcmToken()
  const capabilities = typeof config.deviceCapabilities === 'function' ? config.deviceCapabilities(created) : config.deviceCapabilities
  if (token) await registerDeviceToken(apiClient, token, capabilities)

  return { granted: true }
}

// Also called when FCM rotates the token, otherwise the server keeps pushing to a dead one.
export async function registerDeviceToken(apiClient: AxiosInstance, token: string, capabilities?: DeviceCapabilities): Promise<void> {
  await apiClient.post('/api/v1/notifications/devices', {
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    ...(capabilities?.rideAlertV3 ? { rideAlertV3: true } : {}),
  })
}

export async function unregisterPushNotifications(apiClient: AxiosInstance, token: string | null): Promise<void> {
  if (!token) return
  try {
    await apiClient.delete('/api/v1/notifications/devices', { data: { token } })
  } catch {
    // Best-effort -- logout must not block on this.
  }
}
