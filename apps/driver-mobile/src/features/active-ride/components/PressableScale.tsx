import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)

export type PressableScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>
  pressedScale?: number
}

// Press feedback on press-in (not on release): the 100-150ms scale is what makes a tap
// feel received. Scales the whole control so label and icon move with it. Skipped under
// reduced motion -- the pressed state still reads through the platform's own feedback.
export function PressableScale({ style, pressedScale = 0.97, onPressIn, onPressOut, ...rest }: PressableScaleProps) {
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }))

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        if (!reduced) scale.set(withTiming(pressedScale, { duration: 110, easing: EASE_OUT }))
        onPressIn?.(e)
      }}
      onPressOut={(e) => {
        scale.set(withTiming(1, { duration: 150, easing: EASE_OUT }))
        onPressOut?.(e)
      }}
      style={[style, animated]}
    />
  )
}
