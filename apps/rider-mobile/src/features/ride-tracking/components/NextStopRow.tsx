import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import type { RideStop } from '@ocar/mobile-shared'

export type NextStopRowProps = {
  stop: RideStop
  position: number
  total: number
  busy?: boolean
  onSkip: (stop: RideStop) => void
}

// The next pending stop with its Skip, always visible. Skip used to live only inside the
// collapsed "Trip details" sheet, so riders who never opened it reported having no option.
export function NextStopRow({ stop, position, total, busy = false, onSkip }: NextStopRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.label}>Next stop · {position} of {total}</Text>
        <Text style={styles.address} numberOfLines={1}>{stop.address ?? `Stop ${stop.sequence}`}</Text>
      </View>
      <Pressable
        onPress={() => onSkip(stop)}
        disabled={busy}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Skip stop ${stop.sequence}`}
        style={({ pressed }) => [styles.skip, pressed && styles.pressed, busy && styles.busy]}
      >
        <Text style={styles.skipText}>{busy ? 'Skipping…' : 'Skip'}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface2,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  text: { flex: 1 },
  label: { ...typography.caption, color: colors.ink400, fontFamily: fonts.semibold },
  address: { ...typography.body, color: colors.ink900, fontFamily: fonts.medium },
  skip: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  skipText: { ...typography.label, color: colors.error, fontFamily: fonts.bold },
  pressed: { opacity: 0.6 },
  busy: { opacity: 0.5 },
})
