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

// One quiet row under the stage header (driver) or status title (rider): how much of the booked
// time is left, then the free grace, then extra time. It reads second, after the destination, so it
// is a neutral hairline row (no tint, no amber, no shadow): extra time is billed time, not a fault,
// and the rider is never shown a running charge. Icon AND words in every state; no pulse.
export function TripClock({ copy, stateKey }: TripClockProps) {
  return (
    <Animated.View
      key={stateKey}
      entering={FadeIn.duration(200).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.System)}
      accessible
      accessibilityRole="timer"
      accessibilityLabel={copy.note ? `${copy.a11y}. ${copy.note}` : copy.a11y}
      style={styles.wrap}
    >
      <View style={styles.row}>
        <Feather name={copy.icon} size={18} color={colors.ink600} />
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
  wrap: { minHeight: 52, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: spacing.sm },
  // ink600, not ink400: 4.5:1 on both tints.
  label: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold, flexShrink: 1 },
  value: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  note: { ...typography.caption, color: colors.ink600, paddingLeft: 18 + spacing.sm },
})
