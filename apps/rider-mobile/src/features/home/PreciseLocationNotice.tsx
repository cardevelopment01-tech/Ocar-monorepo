import { Linking, Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { useApproximateLocation } from '@/store/useLocationStore'
import { Text } from './Text'

/** Shown only while the location is approximate (approximate-only permission, or a very rough fix): an exact pickup needs
 *  "Precise location" switched on, which only the rider can do in Settings. */
export function PreciseLocationNotice() {
  const approximate = useApproximateLocation()
  if (!approximate) return null
  return (
    <Pressable
      onPress={() => { void Linking.openSettings() }}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel="Your location is approximate. Open settings to turn on precise location"
    >
      <Feather name="map-pin" size={16} color={colors.ink900} />
      <View style={styles.text}>
        <Text style={styles.title}>Location is approximate</Text>
        <Text style={styles.sub}>Turn on Precise location for an exact pickup</Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.ink600} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.warningLight,
  },
  text: { flex: 1, minWidth: 0 },
  title: { ...typography.body, fontFamily: fonts.semibold, color: colors.ink900 },
  sub: { ...typography.caption, color: colors.ink600 },
})
