import { useEffect, useState } from 'react'
import { Stack, usePathname } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import * as SplashScreen from 'expo-splash-screen'
import {
  SplashOverlay,
  identifyUser,
  initTelemetry,
  resetUser,
  trackScreen,
  useAppFonts,
  wrapRoot,
} from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { useRideRequestListener } from '@/features/ride-requests/useRideRequestListener'
import { RideRequestOverlay } from '@/features/ride-requests/RideRequestOverlay'
import { useSessionSyncListener } from '@/features/go-online/useSessionSyncListener'
import { useSessionResync } from '@/features/go-online/useSessionResync'
import { usePushNotificationRouting } from '@/features/notifications/usePushNotificationRouting'
import { usePushRegistration } from '@/features/notifications/usePushSetup'
import { useStandingSync } from '@/features/account/useStandingSync'
// Registers the background-location TaskManager task at module scope -- must run
// unconditionally at app startup, since Android can invoke the task in a headless
// JS instance after the app process was killed (see backgroundTask.ts).
import '@/services/location/backgroundTask'
import logoMarkImage from '../../assets/brand/logo-mark.png'

SplashScreen.preventAutoHideAsync().catch(() => {})

// Crash, error and usage reporting. Each part is off when its EXPO_PUBLIC_* key is blank and in dev builds.
initTelemetry({
  app: 'driver',
  sentryDsn: process.env['EXPO_PUBLIC_SENTRY_DSN'],
  posthogKey: process.env['EXPO_PUBLIC_POSTHOG_KEY'],
  posthogHost: process.env['EXPO_PUBLIC_POSTHOG_HOST'],
})

function RootLayout() {
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const fontsLoaded = useAppFonts()
  const [showSplashOverlay, setShowSplashOverlay] = useState(true)

  // Root-level ride-request listener, per the plan's binding architecture
  // decision -- mounted once, same place the socket connect lifecycle lives,
  // never per-screen.
  useRideRequestListener()
  useSessionSyncListener()
  useSessionResync()
  usePushNotificationRouting()
  usePushRegistration()
  useStandingSync()

  // Reports are keyed by role and id only (never phone or name), and follow login/logout.
  const accountId = useAuthStore((s) => s.driver?.id)
  useEffect(() => {
    if (accountId) identifyUser('driver', accountId)
    else resetUser()
  }, [accountId])
  const pathname = usePathname()
  useEffect(() => {
    trackScreen(pathname)
  }, [pathname])

  useEffect(() => {
    if (hasHydrated && fontsLoaded) SplashScreen.hideAsync().catch(() => {})
  }, [hasHydrated, fontsLoaded])

  // Splash stays visible until zustand-persist finishes rehydrating (success or
  // failure -- see useAuthStore's onRehydrateStorage) and the brand fonts are
  // loaded, so no screen flashes in the OS default font before Space Grotesk /
  // Plus Jakarta Sans are ready.
  if (!hasHydrated || !fontsLoaded) return null

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* Required for any keyboard-aware animation (useReanimatedKeyboardAnimation
            etc.) to get real keyboard height/progress -- RN's legacy Keyboard module
            detects show/hide by comparing root-view resize, which edgeToEdgeEnabled
            breaks entirely on Android (confirmed on a real device: no resize, no
            event). KeyboardProvider uses the platform's native insets-animation
            callback instead, which works regardless of window-resize behavior. */}
        <KeyboardProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, freezeOnBlur: true }} />
          <RideRequestOverlay />
          {showSplashOverlay ? (
            <SplashOverlay
              logoSource={logoMarkImage}
              onDone={() => setShowSplashOverlay(false)}
            />
          ) : null}
        </KeyboardProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  )
}

export default wrapRoot(RootLayout)
