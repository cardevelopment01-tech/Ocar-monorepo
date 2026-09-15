import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, type DimensionValue, type ViewStyle } from 'react-native'
import { colors, radii } from '../theme/tokens'

export type SkeletonProps = {
  width?: DimensionValue
  height?: number
  borderRadius?: number
  style?: ViewStyle
}

// Uses RN's built-in Animated (not Reanimated) so mobile-shared doesn't need
// GestureHandlerRootView/Reanimated setup just to render a loading placeholder.
export function Skeleton({ width = '100%', height = 16, borderRadius = radii.sm, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.4)).current

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    )
    pulse.start()
    return () => pulse.stop()
  }, [opacity])

  return <Animated.View style={[styles.base, { width, height, borderRadius, opacity }, style]} />
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface3,
  },
})
