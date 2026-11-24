import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated'
import Svg, { Circle } from 'react-native-svg'
import { h } from '../theme/brand'
import { colors, spacing, typography } from '../theme/tokens'

const R = 9
const C = 2 * Math.PI * R

type Props = {
  /** Seconds left before Resend unlocks; 0 = ready. */
  seconds: number
  /** The full wait, for the ring. */
  total: number
  onResend: () => void
  disabled?: boolean
}

/** Under the code boxes: while waiting, a small ring that drains and "Resend code in 0:24"; when the wait ends, a clear teal
 *  "Resend code" button. The old disabled ghost button gave no sense of time passing. */
export function OtpResendRow({ seconds, total, onResend, disabled }: Props) {
  if (seconds > 0) {
    const left = Math.max(0, Math.min(1, seconds / total))
    return (
      <View style={styles.row} accessibilityLabel={`Resend code in ${seconds} seconds`}>
        <Svg width={24} height={24} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={R} fill="none" stroke={colors.border} strokeWidth={2.6} />
          <Circle cx={12} cy={12} r={R} fill="none" stroke={colors.primary} strokeWidth={2.6} strokeLinecap="round" strokeDasharray={`${C * left} ${C}`} transform="rotate(-90 12 12)" />
        </Svg>
        <Text style={styles.waiting}>Resend code in 0:{seconds < 10 ? `0${seconds}` : seconds}</Text>
      </View>
    )
  }
  return (
    <Animated.View entering={FadeIn.duration(220).reduceMotion(ReduceMotion.System)} style={styles.row}>
      <Pressable accessibilityRole="button" onPress={onResend} disabled={disabled} hitSlop={6} style={({ pressed }) => [styles.btn, disabled ? styles.off : null, pressed ? styles.pressed : null]}>
        <Feather name="refresh-cw" size={16} color={h.tealText} />
        <Text style={styles.ready}>Resend code</Text>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  row: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm + 2 },
  waiting: { ...typography.label, fontSize: 13.5, color: h.label, fontWeight: '600', fontVariant: ['tabular-nums'] },
  btn: { height: 44, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 8 },
  ready: { ...typography.label, fontSize: 14.5, fontWeight: '800', color: h.tealText },
  off: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
})
