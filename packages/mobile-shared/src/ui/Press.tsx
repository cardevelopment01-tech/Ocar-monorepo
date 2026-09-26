import type { ReactNode } from 'react'
import { Pressable, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { ease } from '../theme/brand'

type Props = {
  onPress?: (() => void) | undefined
  /** Scale reached while pressed (reference's `:active{transform:scale(x)}`). */
  scaleTo?: number
  /** ms, both directions, the reference's `transition: transform .15s/.18s`. */
  duration?: number
  /** Layout style for the touch target (flex, margin...). */
  hit?: StyleProp<ViewStyle>
  /** Visual style of the scaled element. */
  style?: StyleProp<ViewStyle>
  label?: string
  children: ReactNode | ((p: SharedValue<number>) => ReactNode)
}

/** Pressable whose visual child eases 1 -> scaleTo on press-in and back on release.
 *  `p` (0..1) is handed to children so chips/rings/chevrons can react to the same press. */
export function Press({ onPress, scaleTo = 1, duration = 180, hit, style, label, children }: Props) {
  const p = useSharedValue(0)
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: 1 + (scaleTo - 1) * p.get() }] }))
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => p.set(withTiming(1, { duration, easing: ease.press }))}
      onPressOut={() => p.set(withTiming(0, { duration, easing: ease.press }))}
      style={hit}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Animated.View style={[style, anim]}>{typeof children === 'function' ? children(p) : children}</Animated.View>
    </Pressable>
  )
}
