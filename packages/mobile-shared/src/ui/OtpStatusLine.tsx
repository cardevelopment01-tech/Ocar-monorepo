import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, {
  Easing, FadeIn, FadeOut, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated'
import { colors, spacing, typography } from '../theme/tokens'
import type { OtpWaitStatus } from '../utils/otp'

function Dot({ index, color }: { index: number; color: string }) {
  const reduced = useReducedMotion()
  const o = useSharedValue(0.3)
  useEffect(() => {
    if (reduced) { o.value = 0.7; return }
    o.value = withDelay(index * 160, withRepeat(withSequence(withTiming(1, { duration: 420, easing: Easing.inOut(Easing.quad) }), withTiming(0.3, { duration: 420, easing: Easing.inOut(Easing.quad) })), -1))
  }, [index, o, reduced])
  const style = useAnimatedStyle(() => ({ opacity: o.value }))
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />
}

/** The calm line under the code boxes while the SMS is on its way: three breathing dots, a check once the code is read, and a gentle hint
 *  (where a held-back SMS usually is) when it is slow. Pairs with otpWaitStatus(). */
export function OtpStatusLine({ status }: { status: OtpWaitStatus }) {
  if (status.kind === 'none') return null
  const tone = status.kind === 'detected' ? colors.success : status.kind === 'slow' ? colors.ink600 : colors.primary
  return (
    <Animated.View
      key={status.kind}
      entering={FadeIn.duration(220).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(140).reduceMotion(ReduceMotion.System)}
      style={styles.wrap}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.row}>
        {status.kind === 'detected' ? (
          <View style={[styles.check, { backgroundColor: colors.successLight }]}><Text style={[styles.checkMark, { color: colors.success }]}>✓</Text></View>
        ) : (
          <View style={styles.dots}>{[0, 1, 2].map((i) => <Dot key={i} index={i} color={tone} />)}</View>
        )}
        <Text style={[styles.title, { color: status.kind === 'detected' ? colors.success : colors.ink600 }]}>{status.title}</Text>
      </View>
      {status.kind === 'slow' ? <Text style={styles.hint}>{status.hint}</Text> : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.xs, minHeight: 40, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dots: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  check: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  checkMark: { fontSize: 12, fontWeight: '700', lineHeight: 14 },
  title: { ...typography.label },
  hint: { ...typography.caption, color: colors.ink400, textAlign: 'center' },
})
