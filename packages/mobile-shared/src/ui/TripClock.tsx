import { StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import Animated, { Easing, FadeIn, ReduceMotion } from 'react-native-reanimated'
import { colors, fonts, radii, spacing, typography } from '../theme/tokens'
import type { TripWindowCopy } from '../utils/tripWindow'
import { Text } from './Text'

export type TripClockProps = {
  copy: TripWindowCopy
  /** State kind: a change replays the 200ms cross-fade (and nothing else moves). */
  stateKey: string
}

// One quiet 48px row under the stage header (driver) or status title (rider): how much of the booked
// time is left, then the free grace, then overtime with its live amount. It reads second, after the
// destination, so it is tonal (no card, no shadow) and never red: overtime is billed time, not a fault.
// Every state carries an icon AND words, so nothing depends on colour. No pulse: a ticking number is
// enough. The rider copy adds one line stating the rate from the last 15 minutes on.
export function TripClock({ copy, stateKey }: TripClockProps) {
  const warn = copy.tone === 'warning'
  return (
    <Animated.View
      key={stateKey}
      entering={FadeIn.duration(200).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.System)}
      accessible
      accessibilityRole="timer"
      accessibilityLabel={copy.note ? `${copy.a11y}. ${copy.note}` : copy.a11y}
      style={[styles.wrap, { backgroundColor: warn ? colors.warningLight : colors.primarySubtle }]}
    >
      <View style={styles.row}>
        <Feather name={copy.icon} size={20} color={warn ? colors.ink900 : colors.primary} />
        {/* Wraps instead of truncating: at large font the value drops under its label. */}
        <View style={styles.text}>
          <Text style={styles.label}>{copy.label}</Text>
          <Text style={styles.value}>{copy.value}</Text>
        </View>
      </View>
      {copy.note ? <Text style={styles.note}>{copy.note}</Text> : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radii.lg, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: spacing.sm },
  // ink600, not ink400: 4.5:1 on both tints.
  label: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold, flexShrink: 1 },
  value: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  note: { ...typography.caption, color: colors.ink600, paddingLeft: 20 + spacing.sm },
})
