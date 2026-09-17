import { StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'

export type LiveMarkerProps = {
  markerLat: SharedValue<number>
  markerLng: SharedValue<number>
  originLat: number
  originLng: number
  destLat: number | null
  destLng: number | null
  caption: string
}

// No map dependency in this phase's scope -- this renders the driver's progress as a
// dot sliding along a static pickup-to-drop track instead of a literal map. The dot's
// horizontal position is driven directly off the shared lat/lng values on the UI
// thread (useAnimatedStyle), never through React state, so a fast GPS stream never
// triggers a re-render here.
export function LiveMarker({ markerLat, markerLng, originLat, originLng, destLat, destLng, caption }: LiveMarkerProps) {
  const dotStyle = useAnimatedStyle(() => {
    'worklet'
    const oLat = originLat
    const oLng = originLng
    const dLat = destLat ?? originLat
    const dLng = destLng ?? originLng
    const vx = dLng - oLng
    const vy = dLat - oLat
    const wx = markerLng.value - oLng
    const wy = markerLat.value - oLat
    const lenSq = vx * vx + vy * vy
    const t = lenSq === 0 ? 0 : (wx * vx + wy * vy) / lenSq
    const progress = Math.min(1, Math.max(0, t))
    return { left: `${progress * 100}%` }
  })

  return (
    <View style={styles.container}>
      <View style={styles.track}>
        <View style={styles.endpoint} />
        <Animated.View style={[styles.dot, dotStyle]} />
        <View style={[styles.endpoint, styles.endpointEnd]} />
      </View>
      <Text style={styles.caption}>{caption}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  track: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: radii.full,
    justifyContent: 'center',
  },
  endpoint: {
    position: 'absolute',
    left: -2,
    width: 12,
    height: 12,
    borderRadius: radii.full,
    backgroundColor: colors.ink400,
  },
  endpointEnd: {
    left: undefined,
    right: -2,
    backgroundColor: colors.accentOrange,
  },
  dot: {
    position: 'absolute',
    width: 16,
    height: 16,
    marginLeft: -8,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  caption: {
    fontSize: typography.caption.fontSize,
    color: colors.ink600,
  },
})
