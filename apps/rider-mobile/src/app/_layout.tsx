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

SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const fontsLoaded = useAppFonts()
  const [showSplashOverlay, setShowSplashOverlay] = useState(true)

  useEffect(() => {
    if (hasHydrated && fontsLoaded) SplashScreen.hideAsync().catch(() => {})
  }, [hasHydrated, fontsLoaded])

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
          <Stack screenOptions={{ headerShown: false }} />
          {showSplashOverlay ? (
            <SplashOverlay
              logoSource={require('../../assets/brand/logo-mark.png')}
              onDone={() => setShowSplashOverlay(false)}
            />
          ) : null}
        </KeyboardProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  )
}
