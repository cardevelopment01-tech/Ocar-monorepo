import { useEffect, useState } from 'react'
import { Redirect } from 'expo-router'
import { View } from 'react-native'
import { Button, Card, colors, spacing, typography, Text } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { useOnboardingIntroStore } from '@/store/useOnboardingIntroStore'
import { fetchActiveRideForRelaunch } from '@/features/active-ride/relaunchApi'
import { refreshDriverProfile } from '@/features/account/refreshDriver'
import { restrictionOf, standingRoute } from '@/features/account/accountStanding'

type CheckState = 'checking' | 'done' | 'failed'

// Relaunch-mid-ride recovery: a failure here must block-and-retry, never
// silently fall through to the tab shell as if no ride were active (Eng
// review HIGH-severity finding) -- a driver mid-trip would otherwise be
// stranded with no way back in until the next relaunch.
// Mirrors the web app's ProtectedRoute requireApproved gate: a driver who
// hasn't finished (or was rejected/suspended/banned past) onboarding gets
// routed into the wizard at their saved step instead of the tab shell.
// docs_rejected is deliberately excluded from `needsOnboarding` below: it's a
// returning driver (or one revoked from active) hitting a snag, not a
// first-time applicant, so they go into the tab shell like any active driver
//, Home's rejection banner and Profile's Documents row (both linking to
// /documents) are the actionable surfaces, not the onboarding wizard.
const ONBOARDING_STEP_ROUTES: Record<string, string> = {
  personal_info: '/onboarding/personal',
  vehicle_info: '/onboarding/vehicle',
  documents: '/onboarding/documents',
  selfie: '/onboarding/selfie',
}

export default function Index() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const driver = useAuthStore((s) => s.driver)
  const hasSeenIntro = useOnboardingIntroStore((s) => s.hasSeenIntro)
  const introHydrated = useOnboardingIntroStore((s) => s.hasHydrated)
  const [checkState, setCheckState] = useState<CheckState>('checking')
  const [route, setRoute] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  // docs_rejected drivers go into the app itself (Home's document-gate banner
  // already surfaces the rejection there), matching web's ProtectedRoute.
  // Suspended and banned drivers are NOT mid-application: they go to the account status screen (standingRoute below).
  const needsOnboarding = !!driver && driver.status !== 'active' && driver.status !== 'docs_rejected' && !restrictionOf(driver.status)
  const onboardingRoute = needsOnboarding
    ? (ONBOARDING_STEP_ROUTES[driver.onboarding_step] ?? '/onboarding/pending-review')
    : null

  useEffect(() => {
    if (!isAuthenticated || onboardingRoute) return
    let cancelled = false
    setCheckState('checking')
    void (async () => {
      // Re-read the account first: a driver suspended or banned after they signed in must not land on Home.
      await refreshDriverProfile()
      if (cancelled) return
      const status = useAuthStore.getState().driver?.status
      try {
        // A banned driver is refused everywhere, so there is no ride to look up for them.
        const ride = status === 'banned' ? null : await fetchActiveRideForRelaunch()
        if (cancelled) return
        setRoute(standingRoute(status, ride))
        setCheckState('done')
      } catch {
        if (cancelled) return
        // A suspended driver's token cannot be renewed unless a ride is under way (the server refuses the refresh
        // with 403 DRIVER_SUSPENDED), so a failed lookup that left the account restricted means "no ride": show the
        // status screen rather than an error.
        const now = useAuthStore.getState().driver?.status
        if (restrictionOf(now)) {
          setRoute(standingRoute(now, null))
          setCheckState('done')
        } else {
          setCheckState('failed')
        }
      }
    })()
    return () => { cancelled = true }
  }, [isAuthenticated, retryToken, onboardingRoute])

  if (!introHydrated) return null
  if (!isAuthenticated && !hasSeenIntro) return <Redirect href="/intro" />
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
