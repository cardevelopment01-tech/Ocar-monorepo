import { StyleSheet, View } from 'react-native'
import { colors, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import type { EarningsSummary } from '../types'

export function EarningsBreakdown({ breakdown }: { breakdown: EarningsSummary['breakdown'] }) {
  const rows = [
    { label: 'Gross Fare', value: breakdown.baseFare, neg: false },
    { label: 'Tips', value: breakdown.tips, neg: false },
    { label: 'Incentives', value: breakdown.incentives, neg: false },
    { label: 'Platform Fee', value: breakdown.platformFee, neg: true },
  ]

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Breakdown</Text>
      {rows.map((r, i) => (
        <View key={r.label} style={[styles.row, i < rows.length - 1 ? styles.rowBorder : null]}>
          <Text style={styles.label}>{r.label}</Text>
          <Text style={[styles.value, { color: r.neg ? colors.error : colors.success }]}>
            {r.neg ? '-' : '+'}₹{r.value.toLocaleString('en-IN')}
          </Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii['2xl'], padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  title: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold, marginBottom: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm + 2 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  label: { ...typography.body, color: colors.ink600 },
  value: { ...typography.body, fontFamily: fonts.bold },
})
