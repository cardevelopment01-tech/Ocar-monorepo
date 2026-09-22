import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { colors, radii, shadows, spacing, typography } from '@ocar/mobile-shared'

export type SpeedAlertToastProps = {
  /** Bumps on every new alert -- re-triggers the show/auto-dismiss cycle even
   *  while a previous toast is still fading out. */
  alertKey: number
  limitKmph: number
}

const VISIBLE_MS = 3_500
const ANIM_MS = 220

// Stage 4 stacking priority (locked during /plan-design-review): "3. Transient
// toast (speed alert -- auto-dismissing)" -- sits above the persistent RideSheet
// chrome, below SOSButton/CancelSheet. colors.warning, not colors.error -- the
// token table reserves error strictly for failure states, and speeding is a
// caution, not a failure.
export function SpeedAlertToast({ alertKey, limitKmph }: SpeedAlertToastProps) {
  const insets = useSafeAreaInsets()
  const [visible, setVisible] = useState(false)
  const progress = useSharedValue(0)

  useEffect(() => {
    if (alertKey === 0) return
    setVisible(true)
    progress.set(withTiming(1, { duration: ANIM_MS, easing: Easing.out(Easing.cubic) }))
    let unmountTimer: ReturnType<typeof setTimeout> | null = null
    const hide = setTimeout(() => {
      progress.set(withTiming(0, { duration: ANIM_MS, easing: Easing.in(Easing.cubic) }))
      // Was previously an untracked nested setTimeout -- if the screen
      // unmounts (ride completes, driver navigates away) inside this window,
      // it fired anyway and called setVisible on an unmounted component
      // (code-review finding, 2026-09-22).
      unmountTimer = setTimeout(() => setVisible(false), ANIM_MS)
    }, VISIBLE_MS)
    return () => {
      clearTimeout(hide)
      if (unmountTimer) clearTimeout(unmountTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fires purely off alertKey bumping
  }, [alertKey])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: (1 - progress.get()) * -16 }],
  }))

  if (!visible) return null

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { top: insets.top + spacing.md }, animatedStyle]}>
      <View style={styles.pill}>
        <Feather name="alert-triangle" size={15} color={colors.warning} />
        <Text style={styles.text}>Slow down — limit {limitKmph} km/h</Text>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 9 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.warningLight,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radii.full,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    ...shadows.buttonPrimary,
  },
  text: { ...typography.label, color: colors.ink900, fontWeight: '700' },
})
