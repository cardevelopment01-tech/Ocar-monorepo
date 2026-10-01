import { useEffect } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { Easing, FadeInDown, FadeOut } from 'react-native-reanimated'
import { colors, radii, shadows, spacing, typography, fonts, Text } from '@ocar/mobile-shared'

export type StopAddedBannerProps = {
  /** Null hides it. `noticeKey` bumps per event so a repeat message re-arms the timer. */
  message: string | null
  noticeKey: number
  onDismiss: () => void
}

const VISIBLE_MS = 8_000

// A rider-added stop changes where the driver is going, so it must be seen --
// but the driver is usually driving, so it dismisses itself instead of needing a
// tap. Sits below SpeedAlertToast and left of SOSButton (top-right) so neither
// is covered. `accessibilityLiveRegion` makes TalkBack read it out.
export function StopAddedBanner({ message, noticeKey, onDismiss }: StopAddedBannerProps) {
  const insets = useSafeAreaInsets()

  useEffect(() => {
    if (!message) return
    const t = setTimeout(onDismiss, VISIBLE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arms on each new notice only
  }, [noticeKey, message])

  if (!message) return null

  return (
    <Animated.View
      entering={FadeInDown.duration(220).easing(Easing.out(Easing.cubic))}
      exiting={FadeOut.duration(160)}
      style={[styles.wrap, { top: insets.top + spacing.md + 48 }]}
    >
      <Pressable
        onPress={onDismiss}
        accessibilityRole="alert"
        accessibilityLabel={`${message}. Tap to dismiss.`}
        accessibilityLiveRegion="polite"
        style={styles.pill}
      >
        <Feather name="map-pin" size={16} color={colors.warning} />
        <Text style={styles.text} numberOfLines={2}>{message}</Text>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.md, right: 72, zIndex: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningLight,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radii.lg,
    padding: spacing.sm + 2,
    ...shadows.buttonPrimary,
  },
  text: { ...typography.label, color: colors.ink900, fontFamily: fonts.bold, flex: 1 },
})
