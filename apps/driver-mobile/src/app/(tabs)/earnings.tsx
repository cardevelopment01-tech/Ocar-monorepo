import { StyleSheet, View } from 'react-native'
import { EmptyState, colors, spacing } from '@ocar/mobile-shared'

// Placeholder -- trip history/earnings summary against /me/trips, /me/earnings-summary lands days 8-10.
export default function EarningsScreen() {
  return (
    <View style={styles.container}>
      <EmptyState title="No earnings yet" description="Go online to start accepting rides" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.bg },
})
