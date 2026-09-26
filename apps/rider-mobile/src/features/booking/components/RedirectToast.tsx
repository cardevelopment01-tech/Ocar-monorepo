import { StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInDown, FadeOutDown, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography, fonts } from '@ocar/mobile-shared'
import { useEffect } from 'react'

// Ported from web's RedirectToast (apps/user/components/ui/RedirectToast.tsx) --
// same gradient-card-with-countdown-bar shape, shown whenever /booking's
// Continue auto-redirects the rider to a different flow (in-city vs
// outstation, or a declared ride type that doesn't match the destination).
export function RedirectToast({ message }: { message: string | null }) {
  const insets = useSafeAreaInsets()
  const progress = useSharedValue(1)

  useEffect(() => {
    if (!message) return
    progress.set(1)
    progress.set(withTiming(0, { duration: 1500 }))
  }, [message, progress])

  const barStyle = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }))

  if (!message) return null

  return (
    <Animated.View
      entering={FadeInDown.duration(240)}
      exiting={FadeOutDown.duration(240)}
      style={[styles.container, { bottom: Math.max(insets.bottom, spacing.md) + 68 }]}
      accessibilityRole="alert"
    >
      <View style={styles.row}>
        <Feather name="repeat" size={15} color={colors.inkInverse} />
        <Text style={styles.text}>{message}</Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.bar, barStyle]} />
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    borderRadius: radii.lg + 4,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 6,
    gap: spacing.xs + 2,
    backgroundColor: colors.primaryDark,
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { ...typography.caption, color: colors.inkInverse, fontFamily: fonts.semibold, flex: 1 },
  track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.8)' },
})
