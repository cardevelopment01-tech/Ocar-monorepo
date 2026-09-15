import { StyleSheet, View } from 'react-native'
import { EmptyState, colors, spacing } from '@ocar/mobile-shared'

// Placeholder -- FlashList ride history against /rides/me/history lands days 5-7.
export default function TripsScreen() {
  return (
    <View style={styles.container}>
      <EmptyState title="No trips yet" description="Your ride history will show up here" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.bg },
})
