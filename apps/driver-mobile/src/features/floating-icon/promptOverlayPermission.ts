import { Alert } from 'react-native'
import { overlay } from '@/services/overlay'
import { useAlertPrefsStore } from '@/store/useAlertPrefsStore'

// Asked once, right after the driver first goes online (after the battery prompt, since Android shows one alert at a time), when
// the floating icon is on and the permission is missing. Android will not let an app grant itself "Display over other apps", so
// the driver must allow it in system settings; this explains why first (Play expects a clear reason before the system screen).
// "Not now" is remembered and the app keeps working through the loud notification; the Notification settings switch asks again.
export async function promptOverlayPermissionOnce(): Promise<void> {
  const prefs = useAlertPrefsStore.getState()
  if (!overlay.available || !prefs.hasHydrated || !prefs.floatingIconEnabled) return
  if (prefs.overlayPermissionAsked || overlay.hasPermission()) return
  // Marked asked only once the driver answers, so an alert that never got shown (replaced by another) is retried next time.
  const asked = () => useAlertPrefsStore.getState().setOverlayPermissionAsked(true)
  Alert.alert(
    'Keep Ocar one tap away',
    'Allow Ocar to show a small icon over other apps while you are online, so you can use Maps and come straight back, and so new ride requests open Ocar for you. You can turn this off any time in Notification settings.',
    [
      { text: 'Not now', style: 'cancel', onPress: asked },
      { text: 'Allow', onPress: () => { asked(); overlay.openPermissionSettings() } },
    ],
    { onDismiss: asked }
  )
}
