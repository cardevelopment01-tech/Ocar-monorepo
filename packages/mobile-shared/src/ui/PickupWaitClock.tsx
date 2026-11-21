import { StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import Animated, { Easing, FadeIn, ReduceMotion } from 'react-native-reanimated'
import { colors, fonts, radii, spacing, typography } from '../theme/tokens'
import type { PickupWaitCopy } from '../utils/pickupWait'
import { Text } from './Text'

export type PickupWaitClockProps = {
  copy: PickupWaitCopy
  /** State kind: a change replays the 200ms cross-fade (and nothing else moves). */
  stateKey: string
}

// The waiting clock at the pickup, in the same quiet card as the booked-time clock: icon and words in every state, a tabular
// time on the right, one line under it that states the fixed rate (never a running amount). The free minutes are neutral; once they run
// out the card takes a soft tint and an accent edge (amber for the rider, green for the driver, who is paid for the wait). The tint is
// light enough that the ink text keeps its contrast, and the icon and wording carry the state, so colour is never the only signal.
export function PickupWaitClock({ copy, stateKey }: PickupWaitClockProps) {
  const tone = TONES[copy.tone]
  return (
    <Animated.View
      key={stateKey}
      entering={FadeIn.duration(200).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.System)}
      accessible
      accessibilityRole="timer"
      accessibilityLabel={copy.a11y}
      style={[styles.wrap, { backgroundColor: tone.bg, borderColor: tone.border }]}
    >
      <View style={[styles.accent, { backgroundColor: tone.accent }]} />
      <View style={styles.body}>
        <View style={styles.row}>
          <Feather name={copy.icon} size={18} color={tone.icon} />
          {/* Wraps instead of truncating: at large font the value drops under its label. */}
          <View style={styles.text}>
            <Text style={styles.label}>{copy.label}</Text>
            {copy.value ? <Text style={styles.value}>{copy.value}</Text> : null}
          </View>
        </View>
        {copy.note ? <Text style={styles.note}>{copy.note}</Text> : null}
      </View>
    </Animated.View>
  )
}

const TONES = {
  neutral: { bg: colors.surface, border: colors.border, accent: colors.border, icon: colors.ink600 },
  caution: { bg: colors.warningLight, border: colors.warning, accent: colors.warning, icon: colors.ink900 },
  earn:    { bg: colors.successLight, border: colors.success, accent: colors.success, icon: colors.ink900 },
} as const

const styles = StyleSheet.create({
  wrap: { minHeight: 56, flexDirection: 'row', borderRadius: radii.lg, borderWidth: 1, overflow: 'hidden' },
  accent: { width: 4 },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: spacing.sm },
  // ink600, not ink400: 4.5:1 on white and on both tints.
  label: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold, flexShrink: 1 },
  value: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  note: { ...typography.caption, color: colors.ink600, paddingLeft: 18 + spacing.sm },
})
