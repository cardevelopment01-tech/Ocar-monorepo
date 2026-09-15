import { StyleSheet, Text, View } from 'react-native'
import { Button, Card, colors, spacing, typography } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'

// Toggle is inert/disabled this phase -- real online/offline logic (background
// location, /rides/sessions/online) lands days 8-10.
export default function HomeScreen() {
  const driver = useAuthStore((s) => s.driver)

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>Hi {driver?.full_name ?? 'driver'}</Text>
      <Card style={styles.card}>
        <Text style={styles.status}>Offline</Text>
        <Button label="Go Online" disabled accessibilityHint="Coming soon" />
      </Card>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, backgroundColor: colors.bg, gap: spacing.md },
  greeting: { ...typography.headline, color: colors.ink900 },
  card: { gap: spacing.sm, alignItems: 'center' },
  status: { ...typography.title, color: colors.ink600 },
})
