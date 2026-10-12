import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { colors, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'

// Direct port of the web Earnings page's bar chart -- same spring-in-from-zero
// bar animation, same "empty bars go flat gray" rule (val > 0 gets the accent).
const MIN_SCALE = 0.04

function Bar({ value, maxValue, label }: { value: number; maxValue: number; label: string }) {
  const scale = useSharedValue(0)

  useEffect(() => {
    scale.set(withSpring(value / maxValue, { stiffness: 380, damping: 30 }))
  }, [value, maxValue, scale])

  // Full-height bar scaled from its bottom edge instead of animating `height`; the floor keeps
  // an empty day visible as a thin flat bar (the old minHeight: 4).
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: Math.max(scale.get(), MIN_SCALE) }] }))

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
  title: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, height: 112 },
  barCol: { flex: 1, alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' },
  barTrack: { width: '100%', flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', height: '100%', transformOrigin: 'bottom', borderRadius: 4 },
  barLabel: { ...typography.caption, color: colors.ink400, fontSize: 10 },
})
