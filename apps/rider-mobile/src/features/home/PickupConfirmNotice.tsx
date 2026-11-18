import { useEffect } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, fonts, radii, spacing, track, typography } from '@ocar/mobile-shared'
import { useLocationStore, usePickupNeedsConfirm } from '@/store/useLocationStore'
import { Text } from './Text'

/** Shown when the live fix is too rough to place the pickup itself (about 50 m or worse), instead of silently using it:
 *  on a narrow or divided road that is the other side of the street, and the driver is routed to the wrong kerb. The rider
 *  drops the pin where they will actually stand. Not shown for approximate-only permission (PreciseLocationNotice owns that). */
export function PickupConfirmNotice({ onPress }: { onPress: () => void }) {
  const needsConfirm = usePickupNeedsConfirm()
  const coarse = useLocationStore((s) => s.permissionLevel === 'coarse')
  const accuracy = useLocationStore((s) => s.accuracy)
  const show = needsConfirm && !coarse
  useEffect(() => {
    if (show) track('pickup_confirm_prompted', { accuracy_m: accuracy === null ? null : Math.round(accuracy) })
  }, [show]) // eslint-disable-line react-hooks/exhaustive-deps -- once per time it appears, not on every fix
  if (!show) return null
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      accessibilityRole="button"
      accessibilityLabel="Your location is not exact. Set your pickup spot on the map"
    >
      <View style={styles.icon}>
        <Feather name="crosshair" size={16} color={colors.primary} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>Confirm your pickup spot</Text>
        <Text style={styles.sub} numberOfLines={1}>{accuracy !== null ? `Accurate to ±${Math.round(accuracy)} m · Tap to adjust` : "Tap to place the pin where you'll stand"}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.ink600} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    minHeight: 56,
    // Same 18 px gutters and 20 px corners as the booking screen's route card, so the two read as one column.
    marginHorizontal: 18,
    marginTop: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderRadius: 20,
    backgroundColor: colors.primarySubtle,
  },
  pressed: { opacity: 0.85 },
  icon: { width: 32, height: 32, borderRadius: radii.full, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...typography.body, fontFamily: fonts.semibold, color: colors.ink900 },
  sub: { ...typography.caption, color: colors.ink600 },
})
