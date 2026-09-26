import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'

/**
 * A solid dot with an expanding, fading ring. Used to draw attention to a blocking compliance
 * issue such as a rejected document. Respects the reduced-motion setting.
 */
export function PulseDot({ color = '#EF4444', size = 8 }: { color?: string; size?: number }) {
  const reduced = useReducedMotion()
  const t = useSharedValue(0)

  useEffect(() => {
    if (reduced) return
    t.set(withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.ease) }), -1, false))
  }, [reduced, t])

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + t.get() * 1.8 }],
    opacity: 0.55 * (1 - t.get()),
  }))

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {!reduced ? <Animated.View style={[styles.ring, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }, ringStyle]} /> : null}
      <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute' },
  dot: {},
})
