import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'

// Direct port of the web Earnings page's bar chart -- same spring-in-from-zero
// bar animation, same "empty bars go flat gray" rule (val > 0 gets the accent).
function Bar({ value, maxValue, label }: { value: number; maxValue: number; label: string }) {
  const heightPct = useSharedValue(0)

  useEffect(() => {
    heightPct.value = withSpring((value / maxValue) * 100, { stiffness: 380, damping: 30 })
  }, [value, maxValue, heightPct])

  const style = useAnimatedStyle(() => ({ height: `${heightPct.value}%` }))

  return (
    <View style={styles.barCol}>
      <View style={styles.barTrack}>
        <Animated.View style={[styles.bar, style, { backgroundColor: value > 0 ? colors.accentOrange : colors.border }]} />
      </View>
      <Text style={styles.barLabel}>{label}</Text>
    </View>
  )
}

export function EarningsBarChart({ values, labels }: { values: number[]; labels: string[] }) {
  const maxValue = Math.max(...values, 1)
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Daily Earnings</Text>
      <View style={styles.row} accessibilityRole="image" accessibilityLabel="Earnings chart">
        {values.map((v, i) => (
          <Bar key={i} value={v} maxValue={maxValue} label={labels[i] ?? ''} />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii['2xl'], padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  title: { ...typography.body, color: colors.ink900, fontWeight: '700', marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, height: 112 },
  barCol: { flex: 1, alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' },
  barTrack: { width: '100%', flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', minHeight: 4, borderRadius: 4 },
  barLabel: { ...typography.caption, color: colors.ink400, fontSize: 10 },
})
