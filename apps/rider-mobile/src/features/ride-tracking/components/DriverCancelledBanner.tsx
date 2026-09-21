import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Button, colors, spacing, typography } from '@ocar/mobile-shared'

// Distinguishable from the "searching" state on purpose -- confirmed against
// rides.service.ts's cancelRideAsDriver, a driver cancel is terminal (no server-side
// re-broadcast/reassignment), so the booking is over and the rider must start a new
// one, not wait for a replacement driver.
export function DriverCancelledBanner() {
  const router = useRouter()
  return (
    <View style={styles.container} accessibilityLiveRegion="assertive">
      <Text style={styles.title}>Your driver cancelled this ride</Text>
      <Text style={styles.body}>You'll need to book again to find another driver.</Text>
      <Button label="Book a new ride" onPress={() => router.replace('/(tabs)/home')} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  title: { ...typography.headline, color: colors.error, textAlign: 'center' },
  body: { ...typography.body, color: colors.ink600, textAlign: 'center' },
})
