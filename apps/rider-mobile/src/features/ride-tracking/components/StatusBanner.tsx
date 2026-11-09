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
import { font, h } from '@ocar/mobile-shared'
import { formatEta } from '@ocar/shared'
import { STATUS_CONFIG, type StatusKey } from '../statusConfig'

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

// Design (Driver.dc.html / Ride.dc.html): a small status kicker with the live dot, then the ETA as the hero line
// ("Arriving in 4 min" / "12 min left"). Without an ETA the status label is the hero and the sub-line sits under it.
export function StatusBanner({ status, overrideSub, eta }: StatusBannerProps) {
  const cfg = STATUS_CONFIG[status]
  const sub = overrideSub ?? cfg.sub
  const etaTime = eta ? formatEta(eta.etaMin, eta.distanceKm) : null
  const hero = etaTime ? (status === 'accepted' ? `Arriving in ${etaTime.time}` : `${etaTime.time} left`) : cfg.label
  return (
    <View style={styles.container} accessibilityRole="header">
      {etaTime ? (
        <View style={styles.kickerRow}>
          <PulsingDot color={cfg.dot} pulse={cfg.dotPulse} />
          <Text style={styles.kicker}>{cfg.label}</Text>
        </View>
      ) : null}
      <Text style={etaTime ? styles.hero : styles.heroPlain} numberOfLines={2} maxFontSizeMultiplier={1.2}>{hero}</Text>
      {etaTime ? <Text style={styles.sub}>{etaTime.distance}</Text> : sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 3 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dotWrap: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, position: 'absolute' },
  dotPulse: { width: 12, height: 12, borderRadius: 6, position: 'absolute' },
  kicker: { fontFamily: font.sb, fontSize: 13, color: h.tealText },
  hero: { fontFamily: font.xb, fontSize: 32, lineHeight: 36, letterSpacing: -0.9, color: h.ivory, fontVariant: ['tabular-nums'] },
  heroPlain: { fontFamily: font.xb, fontSize: 24, lineHeight: 30, letterSpacing: -0.5, color: h.ivory },
  sub: { fontFamily: font.m, fontSize: 13, color: h.muted },
})
