import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, {
  Easing,
  FadeIn,
  ZoomIn,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather } from '@expo/vector-icons'
import { font, h } from '@ocar/mobile-shared'

// The sheet's header art: a live route that flows from pickup to drop with a car travelling along it, signal rings
// around the car, a pulsing LIVE chip, and a few "following" avatars popping in. Purely decorative (the real title text
// is selectable and announced); every loop stops when the phone asks for reduced motion.

const VB_W = 342
const VB_H = 206
// One cubic curve drives both the drawn route and the car's position, so the car always rides the line.
// Kept in the upper part of the art so the title written over the lower part never sits on the route.
const P = { x0: 40, y0: 96, x1: 112, y1: 28, x2: 210, y2: 118, x3: 296, y3: 52 }
const ROUTE = `M ${P.x0} ${P.y0} C ${P.x1} ${P.y1}, ${P.x2} ${P.y2}, ${P.x3} ${P.y3}`

const AnimatedPath = Animated.createAnimatedComponent(Path)

function useLoop(duration: number, easing = Easing.linear) {
  const reduced = useReducedMotion()
  const v = useSharedValue(0)
  useEffect(() => {
    if (reduced) { v.set(0); return }
    v.set(withRepeat(withTiming(1, { duration, easing }), -1, false))
  }, [reduced, duration, easing, v])
  return { v, reduced }
}

export function ShareHero() {
  // Route flow: the dotted line slides toward the drop.
  const flow = useSharedValue(0)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (reduced) return
    flow.set(withRepeat(withTiming(-22, { duration: 1500, easing: Easing.linear }), -1, false))
  }, [reduced, flow])
  const routeProps = useAnimatedProps(() => ({ strokeDashoffset: flow.get() }))

  // The car: 0 -> 1 along the curve, easing in and out, then starts over (faded out at both ends so it never pops).
  const t = useSharedValue(0)
  useEffect(() => {
    if (reduced) { t.set(0.46); return }
    t.set(withRepeat(withSequence(withTiming(1, { duration: 5600, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 0 })), -1, false))
  }, [reduced, t])
  const carStyle = useAnimatedStyle(() => {
    const k = t.get()
    const u = 1 - k
    const x = u * u * u * P.x0 + 3 * u * u * k * P.x1 + 3 * u * k * k * P.x2 + k * k * k * P.x3
    const y = u * u * u * P.y0 + 3 * u * u * k * P.y1 + 3 * u * k * k * P.y2 + k * k * k * P.y3
    return {
      left: `${(x / VB_W) * 100}%`,
      top: `${(y / VB_H) * 100}%`,
      opacity: Math.min(1, k / 0.07, (1 - k) / 0.07),
    }
  })

  // Signal rings around the car, and the halo of the LIVE dot.
  const ring = useLoop(1900, Easing.out(Easing.quad))
  const ringStyle = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - ring.v.get()), transform: [{ scale: 1 + 2.4 * ring.v.get() }] }))
  const ringStyle2 = useAnimatedStyle(() => {
    const k = (ring.v.get() + 0.5) % 1
    return { opacity: 0.4 * (1 - k), transform: [{ scale: 1 + 2.4 * k }] }
  })
  const dotHalo = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - ring.v.get()), transform: [{ scale: 1 + 1.6 * ring.v.get() }] }))

  return (
    <View style={styles.hero}>
      <LinearGradient colors={['#12A0B6', '#0B7F93', '#08566A']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />

      <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`}>
          <Defs>
            <RadialGradient id="glow" cx="78%" cy="30%" r="62%">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.28" />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={VB_W} height={VB_H} fill="url(#glow)" />
          {/* A faint street grid, just enough to read as a map. */}
          {[40, 84, 128, 172].map((y) => <Path key={`h${y}`} d={`M 0 ${y} H ${VB_W}`} stroke="#FFFFFF" strokeOpacity="0.07" strokeWidth="1" />)}
          {[58, 116, 174, 232, 290].map((x) => <Path key={`v${x}`} d={`M ${x} 0 V ${VB_H}`} stroke="#FFFFFF" strokeOpacity="0.07" strokeWidth="1" />)}
          {/* The route: a soft base, then the dotted flow on top. */}
          <Path d={ROUTE} stroke="#FFFFFF" strokeOpacity="0.22" strokeWidth="5" strokeLinecap="round" fill="none" />
          <AnimatedPath d={ROUTE} stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 10" fill="none" animatedProps={routeProps} />
          {/* Pickup */}
          <Circle cx={P.x0} cy={P.y0} r="10" fill="#FFFFFF" fillOpacity="0.25" />
          <Circle cx={P.x0} cy={P.y0} r="6" fill="#FFFFFF" />
          {/* Drop */}
          <Circle cx={P.x3} cy={P.y3} r="14" fill="#F6DC9A" fillOpacity="0.3" />
          <Rect x={P.x3 - 7} y={P.y3 - 7} width="14" height="14" rx="4.5" fill="#F6DC9A" />
        </Svg>

        <Animated.View style={[styles.car, carStyle]}>
          <Animated.View style={[styles.ring, ringStyle]} />
          <Animated.View style={[styles.ring, ringStyle2]} />
          <View style={styles.carCore}>
            <View style={styles.carDot} />
          </View>
        </Animated.View>
      </View>

      {/* Legibility scrim for the title that sits on the lower part of the art. */}
      <LinearGradient colors={['rgba(5,40,50,0)', 'rgba(5,40,50,0.55)']} style={styles.scrim} pointerEvents="none" />

      <Animated.View entering={FadeIn.duration(400).delay(120)} style={styles.liveChip} accessibilityElementsHidden importantForAccessibility="no">
        <View style={styles.liveDotWrap}>
          <Animated.View style={[styles.liveHalo, dotHalo]} />
          <View style={styles.liveDot} />
        </View>
        <Text style={styles.liveText}>LIVE</Text>
      </Animated.View>

      <View style={styles.watchers} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {[0, 1, 2].map((i) => (
          <Animated.View key={i} entering={ZoomIn.springify().damping(14).delay(520 + i * 130)} style={[styles.watcher, i > 0 ? { marginLeft: -9 } : null, { backgroundColor: WATCHER_BG[i] }]}>
            <Feather name="user" size={13} color="#0A7788" />
          </Animated.View>
        ))}
      </View>
    </View>
  )
}

const WATCHER_BG = ['#FFFFFF', '#F6EBD0', '#DDF1F4']

const styles = StyleSheet.create({
  hero: { width: '100%', aspectRatio: VB_W / VB_H, overflow: 'hidden' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '58%' },
  car: { position: 'absolute', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFFFFF' },
  carCore: { position: 'absolute', width: 22, height: 22, borderRadius: 11, marginLeft: -11, marginTop: -11, left: 0, top: 0, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(3,40,50,0.35)' },
  carDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: h.tealCta },
  liveChip: { position: 'absolute', top: 18, left: 18, flexDirection: 'row', alignItems: 'center', gap: 7, height: 28, paddingLeft: 10, paddingRight: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.32)' },
  liveDotWrap: { width: 10, height: 10, alignItems: 'center', justifyContent: 'center' },
  liveHalo: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#5FE3A8' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#5FE3A8' },
  liveText: { fontFamily: font.xb, fontSize: 11.5, letterSpacing: 1.2, color: '#FFFFFF' },
  watchers: { position: 'absolute', right: 18, bottom: 18, flexDirection: 'row' },
  watcher: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' },
})
