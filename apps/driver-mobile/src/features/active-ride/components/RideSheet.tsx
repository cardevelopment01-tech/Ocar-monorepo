import { type ReactNode, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { colors, spacing } from '@ocar/mobile-shared'
import { useKeyboardOffset } from '../useKeyboardOffset'

export type RideSheetProps = { children: ReactNode }

const ENTRANCE_DISTANCE = 40
const ENTRANCE_DURATION_MS = 400

// Docks the ride-status content to the bottom edge over the full-bleed map,
// matching RateRiderSheet's shape (handle, 28px top corners, safe-area
// bottom padding) so every sheet in the active-ride flow reads as one
// system instead of a bespoke floating Card per state.
//
// The mount entrance is meant to fire ONCE, the first time this mounts for
// a ride. The caller (active-ride/[id]/index.tsx) renders a different
// <RideSheet> at each ride status via a ternary chain -- previously each
// branch had its own unique `key` ("head-to-pickup", "start-otp", etc.),
// which forces React to unmount+remount on every single status change
// (arrived, start-otp, in-progress, cash collection, complete), replaying
// this on every transition during a live ride instead of just once.
// Never give sibling <RideSheet> branches different keys.
//
// A plain fade + 40px rise (not a spring), matching web's exact bottom-sheet
// entrance (NavigateToPickup.tsx: initial={{ y: 40, opacity: 0 }},
// transition duration 0.4s eased). The earlier version used Reanimated's
// entering={SlideInDown.springify()...}, which animates the whole sheet in
// from fully off-screen and overshoots before settling -- reported as
// "bouncing from top to bottom" on the very first accept. This is a much
// smaller, tween-eased motion instead of a spring, so nothing overshoots.
export function RideSheet({ children }: RideSheetProps) {
  const insets = useSafeAreaInsets()
  const keyboardOffset = useKeyboardOffset()
  const entrance = useSharedValue(0)

  useEffect(() => {
    entrance.set(withTiming(1, { duration: ENTRANCE_DURATION_MS, easing: Easing.out(Easing.cubic) }))
  }, [entrance])

  // This sheet is position:absolute docked to the window bottom -- OTP entry
  // (the most common focused input inside it) would otherwise sit directly
  // behind the keyboard with no reflow. See useKeyboardOffset's own comment
  // for why this can't just be a KeyboardAvoidingView.
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: entrance.get(),
    transform: [{ translateY: (1 - entrance.get()) * ENTRANCE_DISTANCE - keyboardOffset.get() }],
  }))

  return (
    <Animated.View style={[styles.sheet, animatedStyle, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
      <View style={styles.handle} />
      {children}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: spacing.lg,
    gap: spacing.sm,
    shadowColor: 'rgba(15,23,42,1)',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.16)', alignSelf: 'center', marginBottom: spacing.xs },
})
