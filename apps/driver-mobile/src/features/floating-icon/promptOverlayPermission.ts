import { overlay } from '@/services/overlay'
import { useOverlayGuideStore } from '@/store/useOverlayGuideStore'
import { useAlertPrefsStore } from '@/store/useAlertPrefsStore'

// Asked once, right after the driver first goes online (after the battery prompt, since Android shows one alert at a time), when
// the floating icon is on and the permission is missing. Android will not let an app grant itself "Display over other apps", so
// the driver must allow it in system settings; the guide sheet explains why and shows the steps first (Play expects a clear reason before the system screen).
// "Not now" is remembered and the app keeps working through the loud notification; the Notification settings switch asks again.
export async function promptOverlayPermissionOnce(): Promise<void> {
  const prefs = useAlertPrefsStore.getState()
  if (!overlay.available || !prefs.hasHydrated || !prefs.floatingIconEnabled) return
  if (prefs.overlayPermissionAsked || overlay.hasPermission()) return
  // Marked asked as soon as the sheet is shown; "Not now" is remembered, and the Notification settings switch opens it again.
  prefs.setOverlayPermissionAsked(true)
  useOverlayGuideStore.getState().open()
}
