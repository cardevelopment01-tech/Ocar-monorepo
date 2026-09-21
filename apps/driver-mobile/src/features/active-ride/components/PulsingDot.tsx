import { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import { colors } from '@ocar/mobile-shared'

// Matches web's `animate-pulse` on the "heading to pickup" status dot
// (NavigateToPickup.tsx) -- a slow opacity breathe, not the SOS button's
// urgent scale pulse.
export function PulsingDot({ color = colors.primary, size = 10 }: { color?: string; size?: number }) {
  const opacity = useSharedValue(1)

  useEffect(() => {
    opacity.set(withRepeat(withSequence(withTiming(0.35, { duration: 900 }), withTiming(1, { duration: 900 })), -1, true))
  }, [opacity])

  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }))

  return <Animated.View style={[styles.dot, { backgroundColor: color, width: size, height: size, borderRadius: size / 2 }, style]} />
}

const styles = StyleSheet.create({
  dot: {},
})
