import { Redirect, Stack } from 'expo-router'
import { useAuthStore } from '@/store/useAuthStore'

export default function AuthLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (isAuthenticated) return <Redirect href="/(tabs)/home" />
  return <Stack screenOptions={{ headerShown: false }} />
}
