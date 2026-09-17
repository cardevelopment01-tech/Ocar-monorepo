import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import * as SplashScreen from 'expo-splash-screen'
import { SplashOverlay } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { useRideRequestListener } from '@/features/ride-requests/useRideRequestListener'
import { RideRequestOverlay } from '@/features/ride-requests/RideRequestOverlay'
// Registers the background-location TaskManager task at module scope -- must run
// unconditionally at app startup, since Android can invoke the task in a headless
// JS instance after the app process was killed (see backgroundTask.ts).
import '@/services/location/backgroundTask'

SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const [showSplashOverlay, setShowSplashOverlay] = useState(true)

  // Root-level ride-request listener, per the plan's binding architecture
  // decision -- mounted once, same place the socket connect lifecycle lives,
  // never per-screen.
  useRideRequestListener()

  useEffect(() => {
    if (hasHydrated) SplashScreen.hideAsync().catch(() => {})
  }, [hasHydrated])

  // Splash stays visible until zustand-persist finishes rehydrating (success or
  // failure -- see useAuthStore's onRehydrateStorage) so no screen flashes before
  // the auth-state-driven redirects below can fire.
  if (!hasHydrated) return null

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }} />
        <RideRequestOverlay />
        {showSplashOverlay ? (
          <SplashOverlay
            logoSource={require('../../assets/brand/logo-mark.png')}
            onDone={() => setShowSplashOverlay(false)}
          />
        ) : null}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  )
}
