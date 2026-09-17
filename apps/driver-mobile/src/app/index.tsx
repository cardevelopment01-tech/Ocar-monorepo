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
export default function Index() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [checkState, setCheckState] = useState<CheckState>('checking')
  const [route, setRoute] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    if (!isAuthenticated) return
    setCheckState('checking')
    fetchActiveRideForRelaunch()
      .then((ride) => {
        setRoute(relaunchRoute(ride))
        setCheckState('done')
      })
      .catch(() => setCheckState('failed'))
  }, [isAuthenticated, retryToken])

  if (!isAuthenticated) return <Redirect href="/(auth)/phone" />

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
