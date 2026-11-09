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
import { serverNow } from '@/services/api'
import { formatEta } from '@ocar/shared'
import { STATUS_CONFIG, type StatusKey } from '../statusConfig'

export type StatusBannerProps = {
  status: StatusKey
  overrideSub?: string
  eta: { etaMin: number; distanceKm: number } | null
  /** The booked route distance, for the progress bar on a trip (null = unknown, bar hidden). */
  totalKm?: number | null
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
export function StatusBanner({ status, overrideSub, eta, totalKm = null }: StatusBannerProps) {
  const cfg = STATUS_CONFIG[status]
  const sub = overrideSub ?? cfg.sub
  const etaTime = eta ? formatEta(eta.etaMin, eta.distanceKm) : null
  const onTrip = status === 'in_progress' || status === 'returning'
  const hero = etaTime ? (onTrip ? `${etaTime.time} left` : `Arriving in ${etaTime.time}`) : cfg.label
  // "Arrive by" is the ETA on the server clock (the device clock can be off), shown only on a live trip.
  const arriveBy = eta && onTrip
    ? new Date(serverNow() + eta.etaMin * 60_000).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : null
  // Progress = how much of the booked route is behind the car. Only when the booked distance is known.
  const progress = eta && onTrip && totalKm != null && totalKm > 0 ? Math.min(1, Math.max(0, 1 - eta.distanceKm / totalKm)) : null
  return (
    <View accessibilityRole="header">
      <View style={styles.headRow}>
        <View style={styles.headText}>
          {etaTime ? (
            onTrip ? (
              <Text style={styles.kickerMuted}>{etaTime.distance} {status === 'returning' ? 'to pickup' : 'to destination'}</Text>
            ) : (
              <View style={styles.kickerRow}>
                <PulsingDot color={cfg.dot} pulse={cfg.dotPulse} />
                <Text style={styles.kicker}>{cfg.label}</Text>
              </View>
            )
          ) : null}
          <Text style={etaTime ? styles.hero : styles.heroPlain} numberOfLines={2} maxFontSizeMultiplier={1.2}>{hero}</Text>
          {etaTime && !onTrip ? <Text style={styles.sub}>{etaTime.distance}</Text> : !etaTime && sub ? <Text style={styles.sub}>{sub}</Text> : null}
        </View>
        {arriveBy ? (
          <View style={styles.arriveBox}>
            <Text style={styles.arriveLabel}>Arrive by</Text>
            <Text style={styles.arriveTime}>{arriveBy}</Text>
          </View>
        ) : null}
      </View>
      {progress != null ? (
        <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
          <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
          <View style={[styles.trackKnob, { left: `${progress * 100}%` }]} />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  headText: { flex: 1, minWidth: 0, gap: 3 },
  kickerMuted: { fontFamily: font.sb, fontSize: 13, color: h.muted, fontVariant: ['tabular-nums'] },
  arriveBox: { alignItems: 'flex-end', backgroundColor: h.chip, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 14 },
  arriveLabel: { fontFamily: font.sb, fontSize: 12, color: h.label },
  arriveTime: { fontFamily: font.xb, fontSize: 18, color: h.ivory, fontVariant: ['tabular-nums'], marginTop: 1 },
  track: { height: 5, borderRadius: 3, backgroundColor: '#E4ECEC', marginTop: 16, marginBottom: 2, justifyContent: 'center' },
  trackFill: { height: 5, borderRadius: 3, backgroundColor: h.tealCta },
  trackKnob: { position: 'absolute', marginLeft: -6, top: -4, width: 13, height: 13, borderRadius: 7, backgroundColor: '#FFFFFF', borderWidth: 3, borderColor: h.tealCta, boxShadow: '0 2px 6px rgba(14,143,163,0.35)' },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dotWrap: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, position: 'absolute' },
  dotPulse: { width: 12, height: 12, borderRadius: 6, position: 'absolute' },
  kicker: { fontFamily: font.sb, fontSize: 13, color: h.tealText },
  hero: { fontFamily: font.xb, fontSize: 32, lineHeight: 36, letterSpacing: -0.9, color: h.ivory, fontVariant: ['tabular-nums'] },
  heroPlain: { fontFamily: font.xb, fontSize: 24, lineHeight: 30, letterSpacing: -0.5, color: h.ivory },
  sub: { fontFamily: font.m, fontSize: 13, color: h.muted },
})
