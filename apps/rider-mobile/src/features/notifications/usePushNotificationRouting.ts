import { useEffect, useRef } from 'react'
import { router } from 'expo-router'
import { getApp } from '@react-native-firebase/app'
import { getMessaging, getInitialNotification, onNotificationOpenedApp } from '@react-native-firebase/messaging'
import { useAuthStore } from '@/store/useAuthStore'
import { resolvePushRoute } from './pushRouting'

// A cold-start notification tap races the app's own launch-time redirect
// chain -- index.tsx's auth Redirect, then (tabs)/_layout.tsx's own
// fetchActiveRideId crash-recovery redirect (an async network call).
// Navigating immediately can get clobbered by that chain landing afterwards.
// A warm-tap (app was merely backgrounded, not killed) has no such race --
// the router is already mounted and stable, so it navigates immediately.
// This delay is the standard workaround for this exact class of
// deep-link-vs-launch-redirect race in Expo Router apps.
const COLD_START_NAV_DELAY_MS = 600
// Cap on how long a cold-start tap waits for zustand-persist's AsyncStorage
// rehydration before giving up on the auth check -- without this, `navigate`
// would hang forever if hydration itself never resolves (corrupted storage,
// etc.) instead of just dropping the deep-link the way a failed fetch would.
const HYDRATION_WAIT_TIMEOUT_MS = 5_000

// A cold-start tap's 600ms delay isn't guaranteed to land after zustand-persist
// finishes rehydrating auth state from AsyncStorage (RootLayout's own
// `hasHydrated` gate proves this can take longer, especially on the older/
// cold-disk devices this delay exists for) -- reading isAuthenticated too
// early would see the pre-hydration `false` default and silently drop a
// legitimate deep-link (code-review finding, 2026-09-22). Waits for the
// store's own hydration signal instead of trusting the fixed timer.
function waitForAuthHydration(): Promise<void> {
  if (useAuthStore.getState().hasHydrated) return Promise.resolve()
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      resolve()
    }, HYDRATION_WAIT_TIMEOUT_MS)
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (!state.hasHydrated) return
      clearTimeout(timeout)
      unsubscribe()
      resolve()
    })
  })
}

// Root-mounted once (app/_layout.tsx). Handles the two cases a notification
// tap can arrive in:
//   - App was backgrounded (not killed): onNotificationOpenedApp fires.
//   - App was killed, tap launched it: getInitialNotification returns the
//     RemoteMessage that started the process.
// Foreground delivery (app already open) is deliberately NOT handled here --
// no in-app notification feed/toast surface exists yet in rider-mobile to
// show it on (same backlog item as driver-mobile).
export function usePushNotificationRouting(): void {
  const consumedInitial = useRef(false)

  useEffect(() => {
    const messaging = getMessaging(getApp())

    async function navigate(data: Record<string, string> | undefined) {
      await waitForAuthHydration()
      // A rider who logged out between the push arriving and the tap
      // shouldn't be force-navigated into a ride screen mid-auth.
      if (!useAuthStore.getState().isAuthenticated) return
      const target = resolvePushRoute(data)
      if (!target) return
      try {
        // RootLayout renders nothing (no <Stack>) until hydration + fonts are
        // ready, so a push this early has no navigator to land in yet --
        // expo-router typically no-ops/warns, but nothing here guarantees
        // that across versions. Best-effort, matching getInitialNotification's
        // own .catch() below.
        router.push(target)
      } catch {
        // Best-effort -- a rider who can't be deep-linked still has the
        // app open via the notification's default OS tap behavior.
      }
    }

    // Warm tap: app was already running in the background.
    const unsubscribe = onNotificationOpenedApp(messaging, (remoteMessage) => {
      void navigate(remoteMessage.data as Record<string, string> | undefined)
    })

    // Cold start: app process was launched by this notification tap.
    if (!consumedInitial.current) {
      consumedInitial.current = true
      getInitialNotification(messaging)
        .then((remoteMessage) => {
          if (!remoteMessage) return
          const data = remoteMessage.data as Record<string, string> | undefined
          setTimeout(() => void navigate(data), COLD_START_NAV_DELAY_MS)
        })
        .catch(() => {
          // Best-effort -- a rider who can't be deep-linked still has the
          // app open via the notification's default OS tap behavior.
        })
    }

    return unsubscribe
  }, [])
}
