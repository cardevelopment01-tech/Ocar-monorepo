import { StyleSheet, Text, View } from 'react-native'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'

export function FareDriftToast({ previousFare, currentFare, onDismiss }: { previousFare: number; currentFare: number; onDismiss: () => void }) {
  return (
    <View style={styles.driftContainer}>
      <View style={{ flex: 1 }}>
        <Text style={styles.driftLabel}>FARE UPDATED</Text>
        <Text style={styles.driftAmount}>₹{Math.round(previousFare)} → ₹{Math.round(currentFare)}</Text>
      </View>
      <Text style={styles.dismiss} onPress={onDismiss}>Dismiss</Text>
    </View>
  )
}

export function UpgradeToast({ categoryName }: { categoryName: string }) {
  return (
    <View style={styles.upgradeContainer}>
      <Text style={styles.upgradeText}>You've been upgraded to {categoryName} — same fare, more room.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  driftContainer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.warningLight, borderWidth: 1, borderColor: colors.warning, borderRadius: radii.lg, padding: spacing.sm + 4 },
  driftLabel: { ...typography.caption, color: colors.warning, fontWeight: '700', letterSpacing: 0.5 },
  driftAmount: { ...typography.body, color: colors.ink900, fontWeight: '700' },
  dismiss: { ...typography.caption, color: colors.warning, fontWeight: '700' },
  upgradeContainer: { backgroundColor: colors.moneyLight, borderRadius: radii.md, padding: spacing.sm + 4 },
  upgradeText: { ...typography.caption, color: colors.money, fontWeight: '600' },
})
