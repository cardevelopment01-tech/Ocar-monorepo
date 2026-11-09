import { useEffect, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import { colors, radii } from '@ocar/mobile-shared'

// While the voice reads a ride request, the part being read is washed with a soft tint. Opacity only (no layout change,
// nothing moves), fast in and a touch slower out so a hand-off between two parts crossfades instead of blinking.
// Reduced motion keeps the change but makes it instant. The wash is decoration for someone glancing at the screen: the
// sentence itself is the card's accessibility label, so the highlight is hidden from screen readers.

const FADE_IN_MS = 140
const FADE_OUT_MS = 220
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)

const WASH = {
  light: 'rgba(14,143,163,0.12)', // Ocar teal over the white card body
  dark: 'rgba(255,255,255,0.10)', // over the teal hero band; kept low so white text stays above 3:1
} as const

function useFade(on: boolean) {
  const reduced = useReducedMotion()
  const v = useSharedValue(0)
  useEffect(() => {
    v.set(withTiming(on ? 1 : 0, { duration: reduced ? 0 : on ? FADE_IN_MS : FADE_OUT_MS, easing: EASE_OUT }))
  }, [on, reduced, v])
  return v
}

/** Wraps one region of the pop-up. The wash extends past the content (negative inset) so nothing shifts when it appears. */
export function ReadAlong({ active, tone, children }: { active: boolean; tone: keyof typeof WASH; children: ReactNode }) {
  const v = useFade(active)
  const wash = useAnimatedStyle(() => ({ opacity: v.get() }))
  return (
    <View>
      <Animated.View pointerEvents="none" style={[styles.wash, { backgroundColor: WASH[tone] }, wash]} importantForAccessibility="no-hide-descendants" />
      {children}
    </View>
  )
}

/** State only, not a control: lit while the voice is speaking, quiet while it is not. Shown only when the voice is on. */
export function SpeakerBadge({ speaking }: { speaking: boolean }) {
  const v = useFade(speaking)
  const disc = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * v.get() }))
  const lit = useAnimatedStyle(() => ({ opacity: v.get() }))
  return (
    <View style={styles.badge} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[StyleSheet.absoluteFill, styles.disc, disc]} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.disc, styles.discLit, lit]} />
      <Feather name="volume-2" size={16} color={colors.inkInverse} />
    </View>
  )
}

const styles = StyleSheet.create({
  wash: { position: 'absolute', top: -6, bottom: -6, left: -10, right: -10, borderRadius: radii.lg },
  badge: { position: 'absolute', top: 14, right: 20, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  disc: { borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.14)' },
  discLit: { backgroundColor: 'rgba(255,255,255,0.26)' },
})
