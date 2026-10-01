import { type ReactNode, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  interpolate, useAnimatedStyle, useSharedValue, withSpring, Extrapolation,
} from 'react-native-reanimated'
import { colors, spacing } from '@ocar/mobile-shared'

export type CollapsibleRideSheetProps = {
  /** Stage header + the one primary action -- never hides, reachable at any sheet height.
   *  Matches web's NavigateToPickup.tsx/TripInProgress.tsx collapse-anchor pattern
   *  (docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 8): a driver glancing mid-drive needs
   *  the next action, not a shrunk card with nothing on it. */
  alwaysVisible: ReactNode
  /** Rider row, navigate, stops, cancel -- fades and shrinks away as the sheet collapses,
   *  giving the map the space back. */
  children: ReactNode
}

const SNAP_SPRING = { duration: 300, dampingRatio: 0.8 }
const TAP_THRESHOLD_PX = 6
const FLICK_VELOCITY = 800

// Draggable + tap-to-toggle collapsible sheet for the DIY (non-guided) active-ride
// map screens -- the in-house map fallback for drivers who don't open Google
// Navigation SDK guidance. Direct port of the proven web mechanics (Framer Motion
// motionValue + ResizeObserver there; Reanimated shared value + onLayout here),
// not a from-scratch design -- see docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 8.
export function CollapsibleRideSheet({ alwaysVisible, children }: CollapsibleRideSheetProps) {
  const insets = useSafeAreaInsets()
  const [collapsibleHeight, setCollapsibleHeight] = useState(0)
  const collapsibleH = useSharedValue(0)
  // 1 = fully expanded (peek), 0 = fully collapsed -- drives both the clipped
  // height and the fade of the collapsible section below.
  const progress = useSharedValue(1)

  function onCollapsibleLayout(h: number) {
    if (h > 0 && h !== collapsibleHeight) {
      setCollapsibleHeight(h)
      collapsibleH.set(h)
    }
  }

  const pan = Gesture.Pan()
    .onChange((e) => {
      if (collapsibleH.get() <= 0) return
      progress.set(Math.min(1, Math.max(0, progress.get() - e.changeY / collapsibleH.get())))
    })
    .onEnd((e) => {
      const moved = Math.abs(e.translationY)
      if (moved < TAP_THRESHOLD_PX) {
        // Tap, not a drag -- one-handed-friendly toggle (see Phase 8 doc).
        progress.set(withSpring(progress.get() > 0.5 ? 0 : 1, SNAP_SPRING))
        return
      }
      // A flick is enough on its own; otherwise settle on whichever end is nearer.
      if (e.velocityY < -FLICK_VELOCITY) {
        progress.set(withSpring(1, { ...SNAP_SPRING, velocity: -e.velocityY / collapsibleH.get() }))
      } else if (e.velocityY > FLICK_VELOCITY) {
        progress.set(withSpring(0, { ...SNAP_SPRING, velocity: -e.velocityY / collapsibleH.get() }))
      } else {
        progress.set(withSpring(progress.get() > 0.5 ? 1 : 0, SNAP_SPRING))
      }
    })

  const collapsibleStyle = useAnimatedStyle(() => ({
    height: interpolate(progress.get(), [0, 1], [0, collapsibleH.get()], Extrapolation.CLAMP),
    opacity: interpolate(progress.get(), [0, 0.4, 1], [0, 0, 1], Extrapolation.CLAMP),
  }))

  const handleStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: interpolate(progress.get(), [0, 1], [1.5, 1], Extrapolation.CLAMP) }],
  }))

  return (
    <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
      <GestureDetector gesture={pan}>
        <View style={styles.handleHitArea}>
          <Animated.View style={[styles.handle, handleStyle]} />
        </View>
      </GestureDetector>

      {alwaysVisible}

      <Animated.View style={[styles.collapsible, collapsibleStyle]}>
        <View
          onLayout={(e) => onCollapsibleLayout(e.nativeEvent.layout.height)}
          style={styles.collapsibleInner}
        >
          <View style={styles.divider} />
          {children}
        </View>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: {
    // Docked to the window bottom over the full-bleed map, like RideSheet -- without
    // this the sheet sits in normal flow at the TOP of the screen.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg,
    shadowColor: 'rgba(15,23,42,1)',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
  },
  handleHitArea: { alignItems: 'center', paddingTop: spacing.sm + 2, paddingBottom: spacing.md - 2 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.16)' },
  collapsible: { overflow: 'hidden' },
  // Absolute, not in-flow: the parent Animated.View's height is what actually
  // clips this, and an in-flow child would fight that height with its own
  // natural size instead of just being measured by it. The top padding is the gap
  // above the hairline; the gap below it comes from `gap`.
  collapsibleInner: { position: 'absolute', left: 0, right: 0, top: 0, paddingTop: spacing.md, gap: spacing.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
})
