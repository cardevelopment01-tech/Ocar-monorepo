import { StyleSheet, Text, View } from 'react-native'
import { Button, Card, colors, spacing, typography } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { LocationDisclosure } from '@/features/go-online/LocationDisclosure'
import { useLocationSpikeTest } from '@/features/go-online/useLocationSpikeTest'

// Toggle is inert/disabled this phase -- real online/offline logic (background
// location, /rides/sessions/online) lands days 9-10.
export default function HomeScreen() {
  const driver = useAuthStore((s) => s.driver)
  const spike = useLocationSpikeTest()

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>Hi {driver?.full_name ?? 'driver'}</Text>
      <Card style={styles.card}>
        <Text style={styles.status}>Offline</Text>
        <Button label="Go Online" disabled accessibilityHint="Coming soon" />
      </Card>

      {/* Day 5 background-location spike -- verification-only, removed once Days 9-10
          wire proven tracking into the real online/offline flow. */}
      <Card style={styles.card}>
        <Text style={styles.status}>Location test (spike)</Text>
        <Text style={styles.detail}>Status: {spike.status}</Text>
        <Text style={styles.detail}>Fixes logged: {spike.fixCount}</Text>
        {spike.lastFixAt ? (
          <Text style={styles.detail}>Last fix: {new Date(spike.lastFixAt).toLocaleTimeString()}</Text>
        ) : null}
        {spike.errorMessage ? <Text style={styles.error}>{spike.errorMessage}</Text> : null}
        {spike.status === 'tracking' ? (
          <Button label="Stop tracking" variant="secondary" onPress={spike.stop} />
        ) : (
          <Button label="Start tracking" onPress={spike.requestForeground} />
        )}
        <Button label="Clear log" variant="ghost" onPress={spike.clearLog} />
      </Card>

      <LocationDisclosure
        visible={spike.showDisclosure}
        onAccept={spike.handleDisclosureAccept}
        onDecline={spike.handleDisclosureDecline}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, backgroundColor: colors.bg, gap: spacing.md },
  greeting: { ...typography.headline, color: colors.ink900 },
  card: { gap: spacing.sm, alignItems: 'center' },
  status: { ...typography.title, color: colors.ink600 },
  detail: { ...typography.body, color: colors.ink600 },
  error: { ...typography.label, color: colors.error },
})
