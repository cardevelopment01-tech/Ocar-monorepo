import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import * as SplashScreen from 'expo-splash-screen'
import { SplashOverlay, useAppFonts } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { useLocationStore } from '@/store/useLocationStore'
import { MapWarmup } from '@/features/map/components/MapWarmup'
import { usePushNotificationRouting } from '@/features/notifications/usePushNotificationRouting'
import logoMarkImage from '../../assets/brand/logo-mark.png'

SplashScreen.preventAutoHideAsync().catch(() => {})

const LOCATION_HYDRATION_CAP_MS = 1000

export default function RootLayout() {
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const fontsLoaded = useAppFonts()
  const [showSplashOverlay, setShowSplashOverlay] = useState(true)
  // The map seeds its first frame from the saved location, so wait for it to load -- but never longer than
  // LOCATION_HYDRATION_CAP_MS: a slow or failing storage read must not hold the app on the splash.
  const locationHydrated = useLocationStore((s) => s.hydrated)
  const [locationCapHit, setLocationCapHit] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setLocationCapHit(true), LOCATION_HYDRATION_CAP_MS)
    return () => clearTimeout(t)
  }, [])
  const locationReady = locationHydrated || locationCapHit

  usePushNotificationRouting()

  useEffect(() => {
    if (hasHydrated && fontsLoaded && locationReady) SplashScreen.hideAsync().catch(() => {})
  }, [hasHydrated, fontsLoaded, locationReady])

  // Fire the GPS fix + reverse-geocode once, as early as the app can (well
  // before the search screen -- often the booking flow's whole reason for
  // being slow to open -- ever mounts). See useLocationStore's own comment.
  useEffect(() => {
    useLocationStore.getState().init()
  }, [])

  // Splash stays visible until zustand-persist finishes rehydrating (success or
  // failure -- see useAuthStore's onRehydrateStorage) and the brand fonts are
  // loaded, so no screen flashes in the OS default font before Space Grotesk /
  // Plus Jakarta Sans are ready.
  if (!hasHydrated || !fontsLoaded || !locationReady) return null

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
          <MapWarmup />
          <Stack screenOptions={{ headerShown: false }} />
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
