import { Redirect } from 'expo-router'
import { useAuthStore } from '@/store/useAuthStore'
import { useOnboardingIntroStore } from '@/store/useOnboardingIntroStore'

export default function Index() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hasSeenIntro = useOnboardingIntroStore((s) => s.hasSeenIntro)
  const introHydrated = useOnboardingIntroStore((s) => s.hasHydrated)

  if (!introHydrated) return null
  if (!isAuthenticated && !hasSeenIntro) return <Redirect href="/intro" />
  return <Redirect href={isAuthenticated ? '/(tabs)/home' : '/(auth)/phone'} />
}
