import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as SplashScreen from 'expo-splash-screen'
import { useAuthStore } from '@/store/useAuthStore'
// Registers the background-location TaskManager task at module scope -- must run
// unconditionally at app startup, since Android can invoke the task in a headless
// JS instance after the app process was killed (see backgroundTask.ts).
import '@/services/location/backgroundTask'

SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  const hasHydrated = useAuthStore((s) => s.hasHydrated)

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
    </GestureHandlerRootView>
  )
}
