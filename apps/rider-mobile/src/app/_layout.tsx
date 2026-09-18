import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import * as SplashScreen from 'expo-splash-screen'
import { SplashOverlay, useAppFonts } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'

SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const fontsLoaded = useAppFonts()
  const [showSplashOverlay, setShowSplashOverlay] = useState(true)

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
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }} />
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
