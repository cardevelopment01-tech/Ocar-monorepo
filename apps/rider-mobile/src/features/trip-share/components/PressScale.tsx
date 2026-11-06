import type { ReactNode } from 'react'
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { ease } from '@ocar/mobile-shared'

type Props = Omit<PressableProps, 'style' | 'children'> & {
  /** Layout of the touch target. */
  hit?: StyleProp<ViewStyle>
  /** Look of the thing that scales. */
  style?: StyleProp<ViewStyle>
  /** Size while pressed. */
  scaleTo?: number
  children: ReactNode
}

/**
 * A Pressable whose face eases down a little while held and back on release, like every other tap in the app (see `Press` in
 * mobile-shared). Unlike `Press` it passes accessibility props through, so a checkbox row can say it is a checkbox and checked.
 */
export function PressScale({ hit, style, scaleTo = 0.97, children, onPressIn, onPressOut, disabled, ...rest }: Props) {
  const p = useSharedValue(0)
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: 1 + (scaleTo - 1) * p.get() }] }))
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      style={hit}
      onPressIn={(e) => { p.set(withTiming(1, { duration: 140, easing: ease.press })); onPressIn?.(e) }}
      onPressOut={(e) => { p.set(withTiming(0, { duration: 180, easing: ease.press })); onPressOut?.(e) }}
    >
      <Animated.View style={[style, anim]}>{children}</Animated.View>
    </Pressable>
  )
}
