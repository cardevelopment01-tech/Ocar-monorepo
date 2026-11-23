import { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import Animated, {
  Easing, FadeIn, FadeOut, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated'
import { h } from '../theme/brand'
import { colors, spacing, typography } from '../theme/tokens'
import type { OtpWaitStatus } from '../utils/otp'

function Dot({ index }: { index: number }) {
  const reduced = useReducedMotion()
  const o = useSharedValue(0.3)
  useEffect(() => {
    if (reduced) { o.value = 0.7; return }
    o.value = withDelay(index * 160, withRepeat(withSequence(withTiming(1, { duration: 420, easing: Easing.inOut(Easing.quad) }), withTiming(0.3, { duration: 420, easing: Easing.inOut(Easing.quad) })), -1))
  }, [index, o, reduced])
  const style = useAnimatedStyle(() => ({ opacity: o.value }))
  return <Animated.View style={[styles.dot, style]} />
}

/** The line under the code boxes. One slot, always the same height, so the button below never jumps between states:
 *  three breathing dots while waiting, a hint when slow, a green check once the code is read or accepted, a spinner while it is
 *  checked, an icon and a sentence on an error. Pairs with otpWaitStatus(). */
export function OtpStatusLine({ status }: { status: OtpWaitStatus }) {
  return (
    <View style={styles.slot} accessibilityLiveRegion="polite">
      {status.kind === 'none' ? null : (
        <Animated.View
          key={status.kind}
          entering={FadeIn.duration(220).reduceMotion(ReduceMotion.System)}
          exiting={FadeOut.duration(140).reduceMotion(ReduceMotion.System)}
          style={styles.wrap}
        >
          <Row status={status} />
          {status.kind === 'slow' ? <Text style={styles.hint}>{status.hint}</Text> : null}
        </Animated.View>
      )}
    </View>
  )
}

function Row({ status }: { status: OtpWaitStatus }) {
  switch (status.kind) {
    case 'waiting':
      return <View style={styles.row}><View style={styles.dots}><Dot index={0} /><Dot index={1} /><Dot index={2} /></View><Text style={styles.title}>{status.title}</Text></View>
    case 'slow':
      return <Text style={[styles.title, styles.slowTitle]}>{status.title}</Text>
    case 'detected':
    case 'success':
      return (
        <View style={styles.row}>
          <View style={styles.check}><Feather name="check" size={12} color={h.liveInk} /></View>
          <Text style={[styles.title, styles.good]}>{status.title}</Text>
        </View>
      )
    case 'verifying':
      return <View style={styles.row}><ActivityIndicator size="small" color={colors.primary} /><Text style={styles.title}>{status.title}</Text></View>
    case 'error':
      return (
        <View style={styles.errorRow}>
          <Feather name="alert-circle" size={17} color={h.danger} style={styles.errorIcon} />
          <Text style={[styles.title, styles.bad]}>{status.title}</Text>
        </View>
      )
    default:
      return null
  }
}

const styles = StyleSheet.create({
  slot: { minHeight: 72, width: '100%', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 14 },
  wrap: { alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  errorIcon: { marginTop: 1 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  check: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successLight },
  title: { ...typography.label, color: colors.ink600 },
  slowTitle: { fontWeight: '700' },
  good: { color: h.liveInk, fontWeight: '700' },
  bad: { color: h.danger, flexShrink: 1 },
  hint: { ...typography.caption, color: h.label, textAlign: 'center', maxWidth: 300 },
})
