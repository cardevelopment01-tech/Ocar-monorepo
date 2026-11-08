import { useEffect } from 'react'
import { AppState } from 'react-native'
import { useDriverPositionStore } from '@/services/location/driverPositionStore'
import { overlay } from '@/services/overlay'
import { useAlertPrefsStore } from '@/store/useAlertPrefsStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { useRideRequestStore } from '@/store/useRideRequestStore'
import { shouldShowIcon, shouldAutoOpen, speedKmhFromMps, type AppStateName } from './policy'

// Mounted once at the root layout, next to useRideRequestListener. Android only; a build without the native module does nothing.
//  - the floating icon shows while the driver is online and Ocar is not in front, and hides otherwise
//  - a request that arrives while Ocar is in the background pulses the icon and, when the driver allowed it and the gates pass,
//    brings Ocar to the front (the request card, ring and voice are the same ones the app already shows)
// The notification path is unchanged: if anything here declines to act, the loud notification still rings as it does today.

// The speed of the latest fix from the location task that already runs while online (the same source the speed alert uses).
// No fix yet, or a fix without a speed, is unknown, and an unknown speed keeps auto-open closed.
function lastKnownSpeed(): { kmh: number | null; ageMs: number | null } {
  const { position, lastUpdatedAt } = useDriverPositionStore.getState()
  if (!position || lastUpdatedAt === null) return { kmh: null, ageMs: null }
  return { kmh: speedKmhFromMps(position.speed), ageMs: Date.now() - lastUpdatedAt }
}

function inputs(appState: AppStateName) {
  const prefs = useAlertPrefsStore.getState()
  const session = useDriverSessionStore.getState()
  return {
    iconEnabled: prefs.hasHydrated && prefs.floatingIconEnabled,
    autoOpenEnabled: prefs.hasHydrated && prefs.autoOpenEnabled,
    hasPermission: overlay.hasPermission(),
    // Signing out does not clear the in-memory online flag (the server takes the driver offline), so "online" also needs a signed-in driver.
    isOnline: session.isOnline && useAuthStore.getState().isAuthenticated,
    hasActiveRide: session.activeRide !== null,
    appState,
  }
}

export function useFloatingIcon(): void {
  const iconEnabled = useAlertPrefsStore((s) => s.floatingIconEnabled)
  const hydrated = useAlertPrefsStore((s) => s.hasHydrated)
  const isOnline = useDriverSessionStore((s) => s.isOnline)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  // Keep the icon in step with: the opt-in, being online, and whether Ocar is in front.
  useEffect(() => {
    if (!overlay.available) return
    const sync = (appState: AppStateName) => {
      const i = inputs(appState)
      if (shouldShowIcon(i)) overlay.showIcon()
      else overlay.hideIcon()
      // The dot has done its job when the driver is back in Ocar (the request card itself is showing), and it must not outlive the
      // icon's reason to exist (offline, signed out, switched off): otherwise the next appearance would wear a stale dot.
      if (appState === 'active' || !i.isOnline || !i.iconEnabled) overlay.setAlert(false)
    }
    sync(AppState.currentState)
    const sub = AppState.addEventListener('change', sync)
    // No hideIcon here on purpose. A swipe from Recents tears the screen down, and the icon must keep floating (the process and the
    // location service keep running, and the icon's own tap reopens Ocar). A dependency change re-runs sync above straight away,
    // which hides or shows the icon as needed; going offline or switching the icon off do exactly that.
    return () => { sub.remove() }
  }, [iconEnabled, hydrated, isOnline, isAuthenticated])

  // A new request while Ocar is in the background.
  useEffect(() => {
    if (!overlay.available) return
    let lastRideId: string | null = null
    return useRideRequestStore.subscribe((state) => {
      const rideId = state.pending?.rideId ?? null
      if (!rideId) overlay.setAlert(false) // answered, expired or taken: no request is waiting any more
      if (!rideId || rideId === lastRideId) { lastRideId = rideId ?? lastRideId; return }
      lastRideId = rideId
      const appState = AppState.currentState
      if (appState === 'active') return // the in-app card already owns it
      overlay.setAlert(true) // red dot and a steady pulse until the request is answered or the driver is back in Ocar
      overlay.pulseIcon() // a binary without setAlert still gets the single pulse
      const speed = lastKnownSpeed()
      const i = { ...inputs(appState), speedKmh: speed.kmh, speedAgeMs: speed.ageMs }
      if (shouldAutoOpen(i)) overlay.bringToFront()
    })
  }, [])
}
