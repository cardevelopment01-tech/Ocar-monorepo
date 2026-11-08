import { useEffect } from 'react'
import { AppState } from 'react-native'
import { useDriverPositionStore } from '@/services/location/driverPositionStore'
import { overlay } from '@/services/overlay'
import { useAlertPrefsStore } from '@/store/useAlertPrefsStore'
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
    isOnline: session.isOnline,
    hasActiveRide: session.activeRide !== null,
    appState,
  }
}

export function useFloatingIcon(): void {
  const iconEnabled = useAlertPrefsStore((s) => s.floatingIconEnabled)
  const hydrated = useAlertPrefsStore((s) => s.hasHydrated)
  const isOnline = useDriverSessionStore((s) => s.isOnline)

  // Keep the icon in step with: the opt-in, being online, and whether Ocar is in front.
  useEffect(() => {
    if (!overlay.available) return
    const sync = (appState: AppStateName) => {
      const i = inputs(appState)
      if (shouldShowIcon(i)) overlay.showIcon()
      else overlay.hideIcon()
      // The driver is back in Ocar, where the request card itself is showing: the dot has done its job.
      if (appState === 'active') overlay.setAlert(false)
    }
    sync(AppState.currentState)
    const sub = AppState.addEventListener('change', sync)
    return () => {
      sub.remove()
      overlay.hideIcon() // unmount or a dependency change: re-evaluated by the next effect run
    }
  }, [iconEnabled, hydrated, isOnline])

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
