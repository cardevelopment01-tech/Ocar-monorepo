import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { colors } from '@ocar/mobile-shared'

/** Indeterminate progress bar for "finding your driver": a teal segment sweeping across a pale track. */
export function SearchingBar() {
  const reduced = useReducedMotion()
  const t = useSharedValue(0)
  const w = useSharedValue(0)
  useEffect(() => {
    if (reduced) return
    t.set(withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.cubic) }), -1))
  }, [reduced, t])
  const seg = useAnimatedStyle(() => ({
    width: w.get() * 0.38,
    transform: [{ translateX: interpolate(t.get(), [0, 1], [-w.get() * 0.38, w.get()]) }],
  }))
  return (
    <View style={styles.track} onLayout={(e) => w.set(e.nativeEvent.layout.width)} accessibilityRole="progressbar" accessibilityLabel="Searching for a driver">
      <Animated.View style={[styles.seg, seg]} />
    </View>
  )
}

const styles = StyleSheet.create({
  track: { alignSelf: 'stretch', height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.surface3 },
  seg: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
})
