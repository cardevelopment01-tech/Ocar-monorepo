import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { Easing, useReducedMotion, FadeIn, FadeInUp, FadeOut, FadeOutUp, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import { colors, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import { useConnectionBanner } from './useConnectionBanner'
import type { ConnectionBannerKind } from './connectionBannerController'

type Visible = Exclude<ConnectionBannerKind, 'hidden'>

// Calm, specific, no jargon: say what is true for the driver ("requests can't reach you right now") and what happens next ("we reconnect by
// ourselves"), never a raw error. The tone follows the state: amber while it is a problem, green when it is fixed.
const COPY: Record<Visible, { title: string; body: string; icon: keyof typeof Feather.glyphMap; tint: string; wash: string }> = {
  lost:         { title: 'Connection lost',    body: 'Ride requests can’t reach you right now. We’ll reconnect automatically.', icon: 'wifi-off', tint: colors.warning, wash: colors.warningLight },
  reconnecting: { title: 'Reconnecting…', body: 'Hold tight — we’re restoring your connection.',                          icon: 'wifi',     tint: colors.warning, wash: colors.warningLight },
  restored:     { title: 'Back in action',     body: 'You’re connected and receiving requests.',                                    icon: 'check',    tint: colors.success, wash: colors.successLight },
}

// A slim floating capsule, not a bar: it sits over the content without pushing it, never blocks a tap (pointerEvents none), settles in with
// a soft ease and lifts away when done. While reconnecting, the badge breathes so it reads as "working on it", not "stuck".
export function ConnectionBanner() {
  const kind = useConnectionBanner()
  const insets = useSafeAreaInsets()
  const pulse = useSharedValue(1)
  const reconnecting = kind === 'reconnecting'
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (reconnecting && !reduceMotion) pulse.value = withRepeat(withSequence(withTiming(0.45, { duration: 700, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) })), -1)
    else pulse.value = withTiming(1, { duration: 150 })
  }, [reconnecting, reduceMotion, pulse])
  const badgeStyle = useAnimatedStyle(() => ({ opacity: pulse.value }))

  const c = kind === 'hidden' ? null : COPY[kind]

  // The outer layer stays mounted (empty and inert when hidden) so the capsule's exit animation can actually play.
  return (
    <View pointerEvents="none" style={[styles.layer, { top: insets.top + spacing.sm }]}>
      {c ? <Animated.View
        key={kind === 'restored' ? 'restored' : 'trouble'}
        entering={(reduceMotion ? FadeIn : FadeInUp).duration(reduceMotion ? 120 : 280).easing(Easing.out(Easing.cubic))}
        exiting={(reduceMotion ? FadeOut : FadeOutUp).duration(reduceMotion ? 100 : 220).easing(Easing.in(Easing.cubic))}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${c.title}. ${c.body}`}
        style={[styles.capsule, { borderColor: c.tint }]}
      >
        <Animated.View style={[styles.badge, { backgroundColor: c.wash }, badgeStyle]}>
          <Feather name={c.icon} size={18} color={c.tint} />
        </Animated.View>
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={1}>{c.title}</Text>
          <Text style={styles.body} numberOfLines={2}>{c.body}</Text>
        </View>
      </Animated.View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: spacing.md, right: spacing.md, alignItems: 'center', zIndex: 50, elevation: 50 },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    maxWidth: 460,
    paddingVertical: spacing.sm + 2,
    paddingLeft: spacing.sm + 2,
    paddingRight: spacing.md,
    borderRadius: radii['2xl'],
    borderWidth: StyleSheet.hairlineWidth * 2,
    backgroundColor: 'rgba(255,255,255,0.97)',
    shadowColor: '#14171A',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  badge: { width: 36, height: 36, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center' },
  copy: { flexShrink: 1 },
  title: { ...typography.label, color: colors.ink900, fontFamily: fonts.bold },
  body: { ...typography.caption, color: colors.ink600, fontFamily: fonts.regular, marginTop: 1 },
})
