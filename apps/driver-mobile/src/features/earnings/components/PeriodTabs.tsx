import { Pressable, StyleSheet, View } from 'react-native'
import { colors, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import type { EarningsPeriod } from '../types'

const PERIODS: { key: EarningsPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
]

export function PeriodTabs({ value, onChange }: { value: EarningsPeriod; onChange: (p: EarningsPeriod) => void }) {
  return (
    <View style={styles.row}>
      {PERIODS.map((p) => {
        const active = value === p.key
        return (
          <Pressable key={p.key} onPress={() => onChange(p.key)} style={[styles.tab, active ? styles.tabActive : null]}>
            <Text numberOfLines={1} style={[styles.text, active ? styles.textActive : null]}>{p.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4, backgroundColor: colors.surface2, borderRadius: radii.xl, padding: 6, borderWidth: 1, borderColor: colors.border },
  tab: { flex: 1, paddingVertical: spacing.sm, borderRadius: radii.lg, alignItems: 'center' },
  tabActive: { backgroundColor: colors.surface },
  text: { ...typography.caption, color: colors.ink400, fontFamily: fonts.bold },
  textActive: { color: colors.primary },
})
