import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { STATUS_CONFIG, statusBg, type StatusKey } from '../statusConfig'

export type StatusBannerProps = {
  status: StatusKey
  overrideSub?: string
  eta: { etaMin: number; distanceKm: number } | null
}

// Reduced-motion users still see the plain dot (state is legible without the
// pulse); everyone else gets a 0->1 ramp looped on the UI thread, driving both
// opacity and scale off one shared value -- was two `Animated.Value`s on the
// RN-runtime `Animated` API, which this project's own rules ban for anything
// beyond a one-shot fade (Reanimated only).
function PulsingDot({ color, pulse }: { color: string; pulse: boolean }) {
  const reduced = useReducedMotion()
  const active = pulse && !reduced
  const t = useSharedValue(0)

  useEffect(() => {
    if (active) {
      t.set(withRepeat(withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }), -1, false))
    } else {
      cancelAnimation(t)
      t.set(0)
    }
  }, [active, t])

  const style = useAnimatedStyle(() => ({
    opacity: 0.6 * (1 - t.get()),
    transform: [{ scale: 1 + t.get() * 1.2 }],
  }))

  return (
    <View style={styles.dotWrap}>
      {active ? <Animated.View style={[styles.dotPulse, { backgroundColor: color }, style]} /> : null}
      <View style={[styles.dot, { backgroundColor: color }]} />
    </View>
  )
}

// Colored status header -- direct port of the web tracking page's status badge row
// (STATUS_CONFIG-driven background/border/dot color + pulsing dot + live ETA).
export function StatusBanner({ status, overrideSub, eta }: StatusBannerProps) {
  const cfg = STATUS_CONFIG[status]
  const sub = overrideSub ?? cfg.sub
  const { bg, border } = statusBg(status)

  return (
    <View style={[styles.container, { backgroundColor: bg, borderColor: border }]}>
      <PulsingDot color={cfg.dot} pulse={cfg.dotPulse} />
      <View style={styles.textCol}>
        <Text style={styles.label}>{cfg.label}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {eta ? (
        <View style={styles.etaCol}>
          <Text style={styles.etaMin}>{eta.etaMin} min</Text>
          <Text style={styles.etaKm}>{eta.distanceKm.toFixed(1)} km</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4,
    borderRadius: radii.xl, borderWidth: 1,
  },
  dotWrap: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, position: 'absolute' },
  dotPulse: { width: 12, height: 12, borderRadius: 6, position: 'absolute' },
  textCol: { flex: 1, gap: 2 },
  label: { ...typography.label, color: colors.ink900, fontWeight: '700' },
  sub: { ...typography.caption, color: colors.ink600 },
  etaCol: { alignItems: 'flex-end' },
  etaMin: { ...typography.label, color: colors.ink900, fontWeight: '700' },
  etaKm: { ...typography.caption, color: colors.ink600 },
})
