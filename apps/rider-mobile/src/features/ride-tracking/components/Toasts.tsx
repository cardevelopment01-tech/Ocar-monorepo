import { StyleSheet, Text, View } from 'react-native'
import { colors, radii, spacing, typography, fonts } from '@ocar/mobile-shared'

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
      <Text style={styles.upgradeText}>You've been upgraded to {categoryName}. Same fare, more room.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  driftContainer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.warningLight, borderWidth: 1, borderColor: colors.warning, borderRadius: radii.lg, padding: spacing.sm + 4 },
  driftLabel: { ...typography.caption, color: colors.warning, fontFamily: fonts.bold, letterSpacing: 0.5 },
  driftAmount: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  dismiss: { ...typography.caption, color: colors.warning, fontFamily: fonts.bold },
  upgradeContainer: { backgroundColor: colors.moneyLight, borderRadius: radii.md, padding: spacing.sm + 4 },
  upgradeText: { ...typography.caption, color: colors.money, fontFamily: fonts.semibold },
})
