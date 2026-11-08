import { useEffect } from 'react'
import { Alert, AppState } from 'react-native'
import * as Location from 'expo-location'
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

async function lastKnownSpeed(): Promise<{ kmh: number | null; ageMs: number | null }> {
  try {
    const pos = await Location.getLastKnownPositionAsync({ maxAge: 20_000 })
    if (!pos) return { kmh: null, ageMs: null }
    return { kmh: speedKmhFromMps(pos.coords.speed), ageMs: Date.now() - pos.timestamp }
  } catch {
    return { kmh: null, ageMs: null }
  }
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
    }
    sync(AppState.currentState)
    const sub = AppState.addEventListener('change', sync)
    return () => {
      sub.remove()
      overlay.hideIcon() // unmount or a dependency change: re-evaluated by the next effect run
    }
  }, [iconEnabled, hydrated, isOnline])

  // Ask once, the first time the driver goes online with the icon on and the permission missing. Android will not let an app grant
  // itself "Display over other apps", so the driver must allow it in system settings; this explains why first. "Not now" is
  // remembered and the app keeps working through the notification; the Notification settings switch asks again on demand.
  useEffect(() => {
    if (!overlay.available || !hydrated || !iconEnabled || !isOnline) return
    const prefs = useAlertPrefsStore.getState()
    if (prefs.overlayPermissionAsked || overlay.hasPermission()) return
    prefs.setOverlayPermissionAsked(true)
    Alert.alert(
      'Keep Ocar one tap away',
      'Allow Ocar to show a small icon over other apps while you are online, so you can use Maps and come straight back, and so new ride requests open Ocar for you. You can turn this off any time in Notification settings.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Allow', onPress: () => overlay.openPermissionSettings() },
      ]
    )
  }, [hydrated, iconEnabled, isOnline])

  // A new request while Ocar is in the background.
  useEffect(() => {
    if (!overlay.available) return
    let lastRideId: string | null = null
    return useRideRequestStore.subscribe((state) => {
      const rideId = state.pending?.rideId ?? null
      if (!rideId || rideId === lastRideId) { lastRideId = rideId ?? lastRideId; return }
      lastRideId = rideId
      const appState = AppState.currentState
      if (appState === 'active') return // the in-app card already owns it
      overlay.pulseIcon()
      void (async () => {
        const speed = await lastKnownSpeed()
        const i = { ...inputs(appState), speedKmh: speed.kmh, speedAgeMs: speed.ageMs }
        if (shouldAutoOpen(i)) overlay.bringToFront()
      })()
    })
  }, [])
}
