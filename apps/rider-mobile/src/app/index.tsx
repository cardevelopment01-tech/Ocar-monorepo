import { Redirect } from 'expo-router'
import { useAuthStore } from '@/store/useAuthStore'
import { useOnboardingIntroStore } from '@/store/useOnboardingIntroStore'
import { usePermissionGate } from '@/features/permissions/permissionSetup'

export default function Index() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hasSeenIntro = useOnboardingIntroStore((s) => s.hasSeenIntro)
  const introHydrated = useOnboardingIntroStore((s) => s.hasHydrated)
  const gate = usePermissionGate(isAuthenticated)

  if (!introHydrated) return null
  if (!isAuthenticated && !hasSeenIntro) return <Redirect href="/intro" />
  if (!isAuthenticated) return <Redirect href="/(auth)/phone" />
  if (gate === 'checking') return null
  return <Redirect href={gate === 'show' ? '/permissions' : '/(tabs)/home'} />
}
