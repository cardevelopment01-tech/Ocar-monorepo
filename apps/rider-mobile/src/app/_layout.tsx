import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as SplashScreen from 'expo-splash-screen'
import { SplashOverlay } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'

SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const [showSplashOverlay, setShowSplashOverlay] = useState(true)

  useEffect(() => {
    if (hasHydrated) SplashScreen.hideAsync().catch(() => {})
  }, [hasHydrated])

  // Splash stays visible until zustand-persist finishes rehydrating (success or
  // failure -- see useAuthStore's onRehydrateStorage) so no screen flashes before
  // the auth-state-driven redirects below can fire.
  if (!hasHydrated) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
      {showSplashOverlay ? (
        <SplashOverlay
          logoSource={require('../../assets/brand/logo-mark.png')}
          onDone={() => setShowSplashOverlay(false)}
        />
      ) : null}
    </GestureHandlerRootView>
  )
}
