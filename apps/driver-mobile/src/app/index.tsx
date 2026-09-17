import { useEffect, useState } from 'react'
import { Redirect } from 'expo-router'
import { Text, View } from 'react-native'
import { Button, Card, colors, spacing, typography } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { fetchActiveRideForRelaunch } from '@/features/active-ride/relaunchApi'
import { relaunchRoute } from '@/features/active-ride/relaunchRouting'

type CheckState = 'checking' | 'done' | 'failed'

// Relaunch-mid-ride recovery: a failure here must block-and-retry, never
// silently fall through to the tab shell as if no ride were active (Eng
// review HIGH-severity finding) -- a driver mid-trip would otherwise be
// stranded with no way back in until the next relaunch.
// Mirrors the web app's ProtectedRoute requireApproved gate: a driver who
// hasn't finished (or was rejected/suspended/banned past) onboarding gets
// routed into the wizard at their saved step instead of the tab shell.
// docs_rejected is a returning driver hitting a snag, not a first-time
// applicant -- sent into pending-review (which handles that status itself),
// never back into the wizard.
const ONBOARDING_STEP_ROUTES: Record<string, string> = {
  personal_info: '/onboarding/personal',
  vehicle_info: '/onboarding/vehicle',
  documents: '/onboarding/documents',
  selfie: '/onboarding/selfie',
}

export default function Index() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const driver = useAuthStore((s) => s.driver)
  const [checkState, setCheckState] = useState<CheckState>('checking')
  const [route, setRoute] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  // docs_rejected drivers go into the app itself (Home's document-gate banner
  // already surfaces the rejection there), matching web's ProtectedRoute.
  const needsOnboarding = !!driver && driver.status !== 'active' && driver.status !== 'docs_rejected'
  const onboardingRoute = needsOnboarding
    ? (ONBOARDING_STEP_ROUTES[driver.onboarding_step] ?? '/onboarding/pending-review')
    : null

  useEffect(() => {
    if (!isAuthenticated || onboardingRoute) return
    setCheckState('checking')
    fetchActiveRideForRelaunch()
      .then((ride) => {
        setRoute(relaunchRoute(ride))
        setCheckState('done')
      })
      .catch(() => setCheckState('failed'))
  }, [isAuthenticated, retryToken, onboardingRoute])

  if (!isAuthenticated) return <Redirect href="/(auth)/phone" />
  if (onboardingRoute) return <Redirect href={onboardingRoute} />

  if (checkState === 'failed') {
    return (
      <View style={styles.container}>
        <Card style={styles.card}>
          <Text style={styles.title}>Couldn't check for an active ride</Text>
          <Button label="Retry" onPress={() => setRetryToken((t) => t + 1)} />
        </Card>
      </View>
    )
  }

  if (checkState === 'checking' || !route) return null

  return <Redirect href={route} />
}

const styles = {
  container: { flex: 1, justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.bg } as const,
  card: { gap: spacing.sm } as const,
  title: { ...typography.title, color: colors.ink900 } as const,
}
