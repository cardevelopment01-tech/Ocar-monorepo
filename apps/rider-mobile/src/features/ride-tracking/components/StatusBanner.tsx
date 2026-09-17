import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { STATUS_CONFIG, statusBg, type StatusKey } from '../statusConfig'

export type StatusBannerProps = {
  status: StatusKey
  overrideSub?: string
  eta: { etaMin: number; distanceKm: number } | null
}

function PulsingDot({ color, pulse }: { color: string; pulse: boolean }) {
  const scale = useRef(new Animated.Value(1)).current
  const opacity = useRef(new Animated.Value(0.6)).current

  useEffect(() => {
    if (!pulse) return
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 2.2, duration: 900, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0, duration: 900, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.6, duration: 0, useNativeDriver: true }),
        ]),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pulse, scale, opacity])

  return (
    <View style={styles.dotWrap}>
      {pulse ? (
        <Animated.View style={[styles.dotPulse, { backgroundColor: color, opacity, transform: [{ scale }] }]} />
      ) : null}
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
