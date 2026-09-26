import { useEffect } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, {
  type SharedValue,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg'
import { ease, font, geo, h } from '@/theme/homeTokens'
import { MapPinIcon } from './icons'
import { Text } from './Text'

/** Distance from the hero's bottom edge to the rider's exact location (the pin tip / ring dot centre).
 *  The sheet overlaps the bottom 22px, so the point sits just clear of it. */
export const POINT = 43

const OUTLINE = 'rgba(14,143,163,0.22)' // teal-tinted hairline that defines the frosted pill on a pale map
const PILL_H = 44
const PILL_MIN = 22 // the pill's collapsed size = the teardrop's head
const HEAD_CENTER = POINT - 1 + (34 - 11.8) // bottom offset of the pin head's centre (24x34 svg, tip at its base)
const PILL_BOTTOM = POINT + 20 // resting pill bottom: the tail tip lands on top of the ring dot
const SHRINK = 0.8 // morph progress at which the pill has become the pin head
const CHANGE_PX = 60 // how far the sheet must move from rest for the morph to complete

// Soft breathing halo under the location point: scale .82 -> 1.3, opacity .5 -> 1, 4.2s ease-in-out.
function Pulse() {
  const t = useSharedValue(0)
  useEffect(() => {
    t.set(withRepeat(withSequence(withTiming(1, { duration: 2100, easing: ease.inOut }), withTiming(0, { duration: 2100, easing: ease.inOut })), -1))
  }, [t])
  const style = useAnimatedStyle(() => ({ opacity: 0.5 + 0.5 * t.get(), transform: [{ scale: 0.82 + 0.48 * t.get() }] }))
  // radial-gradient in a 28px round box: CSS farthest-corner radius, so the disc clips at ~10% alpha
  return (
    <Animated.View style={[styles.pulse, style]} pointerEvents="none">
      <Svg width={28} height={28}>
        <Defs>
          <RadialGradient id="pulseGrad" cx={14} cy={14} r={19.8} gradientUnits="userSpaceOnUse">
            <Stop offset={0} stopColor={h.teal} stopOpacity={0.5} />
            <Stop offset={0.55} stopColor={h.teal} stopOpacity={0.16} />
            <Stop offset={1} stopColor={h.teal} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={14} cy={14} r={14} fill="url(#pulseGrad)" />
      </Svg>
    </Animated.View>
  )
}

/**
 * Address callout in the ride-app style: a wide frosted pill (dot, bold-then-regular address), a small
 * tail pointing down at the location marker underneath. As the sheet moves off its resting height --
 * dragged open, or scrolled toward collapse, the pill shrinks to a dot, turns teal, and becomes the
 * teardrop pin (tail and ring dot dissolve). Driven entirely by the hero's height, so it tracks a finger drag.
 */
export function LocationCallout({ height, address }: { height: SharedValue<number>; address: string }) {
  const { width } = useWindowDimensions()
  const full = width - 32

  // 0 = pill (rest), 1 = pin
  const m = useDerivedValue(() => Math.min(1, Math.abs(height.get() - geo.peek) / CHANGE_PX))
  const k = useDerivedValue(() => Math.min(1, m.get() / SHRINK))

  const anchor = useAnimatedStyle(() => ({ bottom: interpolate(m.get(), [0, 1], [PILL_BOTTOM, HEAD_CENTER - PILL_MIN / 2]) }))
  const pill = useAnimatedStyle(() => ({
    width: interpolate(k.get(), [0, 1], [full, PILL_MIN]),
    height: interpolate(k.get(), [0, 1], [PILL_H, PILL_MIN]),
    backgroundColor: interpolateColor(m.get(), [0, 0.5, 1], ['rgb(253,254,254)', 'rgb(253,254,254)', '#14ABBD']),
    opacity: interpolate(m.get(), [0.6, 1], [1, 0], 'clamp'),
  }))
  const content = useAnimatedStyle(() => ({ opacity: interpolate(m.get(), [0, 0.3], [1, 0], 'clamp') }))
  const tail = useAnimatedStyle(() => ({ opacity: interpolate(m.get(), [0, 0.22], [1, 0], 'clamp') }))
  const ring = useAnimatedStyle(() => ({ opacity: interpolate(m.get(), [0, 0.5], [1, 0], 'clamp') }))
  const pin = useAnimatedStyle(() => ({
    opacity: interpolate(m.get(), [0.55, 1], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(m.get(), [0.55, 1], [0.7, 1], 'clamp') }],
  }))

  const i = address.indexOf(',')
  const lead = i < 0 ? address : address.slice(0, i + 1)
  const rest = i < 0 ? '' : address.slice(i + 1)

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Pulse />
      <Animated.View style={[styles.ring, ring]}>
        <View style={styles.ringCore} />
      </Animated.View>
      <Animated.View style={[styles.pin, pin]}>
        <MapPinIcon />
      </Animated.View>

      <Animated.View style={[styles.anchor, anchor]}>
        <Animated.View style={[styles.tail, tail]} />
        <Animated.View style={[styles.pill, pill]}>
          <Animated.View style={[styles.row, content, { width: full - 28 }]}>
            <View style={styles.dot} />
            <Text style={styles.text} numberOfLines={1}>
              <Text style={styles.lead}>{lead}</Text>
              {rest}
            </Text>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  pulse: { position: 'absolute', left: '50%', marginLeft: -14, bottom: POINT - 14, width: 28, height: 28 },
  // the point itself: a teal ring with a white core, like the ring dot under the callout
  ring: {
    position: 'absolute',
    left: '50%',
    marginLeft: -9,
    bottom: POINT - 9,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: h.teal,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 6px rgba(10,60,66,0.28)',
  },
  ringCore: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
  // teardrop, tip on the point (svg is 24x34 with the tip at its base)
  pin: { position: 'absolute', left: '50%', marginLeft: -12, bottom: POINT - 1, width: 24, height: 34, transformOrigin: '50% 100%' },
  anchor: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  // rotated square tucked half under the pill = the callout's pointer
  // outlined like the pill; only its two lower edges (after the 45deg turn) carry the border
  tail: {
    position: 'absolute',
    bottom: -7,
    width: 16,
    height: 16,
    borderRadius: 3,
    backgroundColor: 'rgb(253,254,254)',
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: OUTLINE,
    boxShadow: '3px 3px 8px rgba(14,143,163,0.14)',
    transform: [{ rotate: '45deg' }],
  },
  pill: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: OUTLINE,
    overflow: 'hidden',
    // teal-tinted glow, like the halo around the reference callout
    boxShadow: '0 8px 24px rgba(14,143,163,0.20), 0 2px 6px rgba(20,23,26,0.08)',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: h.teal, boxShadow: `0 0 0 4px ${h.tealSoft}`, marginLeft: 3 },
  text: { flex: 1, fontFamily: font.r, fontSize: 14, color: h.ivory },
  lead: { fontFamily: font.b },
})
