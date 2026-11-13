import { Redirect, Stack } from 'expo-router'
import { useAuthStore } from '@/store/useAuthStore'

export default function AuthLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  // Signed in goes through "/", the one gate that decides between the onboarding wizard, a ride in progress and Home. Sending
  // straight to Home here as well made Home open twice after login (this redirect, then the "/" check a moment later), which
  // showed as the screen flashing and reloading right after the location prompt.
  if (isAuthenticated) return <Redirect href="/" />
  return <Stack screenOptions={{ headerShown: false }} />
}
