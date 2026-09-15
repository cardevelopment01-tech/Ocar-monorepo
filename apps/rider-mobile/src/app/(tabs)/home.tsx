import { StyleSheet, Text, View } from 'react-native'
import { Input, colors, spacing, typography } from '@ocar/mobile-shared'

// Static "Where to?" shell -- real map + booking flow lands days 5-7.
export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>Where to?</Text>
      <Input placeholder="Enter destination" editable={false} accessibilityLabel="Search destination" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, backgroundColor: colors.bg, gap: spacing.md },
  greeting: { ...typography.headline, color: colors.ink900 },
})
