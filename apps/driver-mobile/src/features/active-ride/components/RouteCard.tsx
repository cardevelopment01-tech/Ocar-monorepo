import { StyleSheet, View } from 'react-native'
import { colors, dropDisplay, fonts, spacing, typography, Text } from '@ocar/mobile-shared'

export type RouteCardProps = {
  rideType: string
  originAddress: string | null
  destinationAddress: string | null
  tripHours: number | null
}

// Where this trip started and where it ends, in full, in every stage. The stage header only ever names the
// next place to go, so mid-trip the pickup (and, before pickup, the drop) was nowhere on screen. Addresses wrap
// to three lines instead of being cut to one; a rental shows its real drop with the package as a caption.
export function RouteCard({ rideType, originAddress, destinationAddress, tripHours }: RouteCardProps) {
  const drop = dropDisplay({ rideType, destinationAddress, tripHours })
  return (
    <View style={styles.row} accessible accessibilityLabel={`Pickup ${originAddress ?? 'not set'}. ${drop.label} ${drop.value}.`}>
      <View style={styles.dots}>
        <View style={[styles.dot, styles.dotPickup]} />
        <View style={styles.line} />
        <View style={[styles.dot, styles.dotDrop]} />
      </View>
      <View style={styles.text}>
        <View>
          <Text style={styles.label}>Pickup</Text>
          <Text style={styles.value} numberOfLines={3}>{originAddress ?? 'Pickup location'}</Text>
        </View>
        <View>
          <Text style={styles.label}>{drop.label}</Text>
          <Text style={styles.value} numberOfLines={3}>{drop.value}</Text>
          {drop.note ? <Text style={styles.note}>{drop.note}</Text> : null}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm + 4 },
  dots: { alignItems: 'center', paddingVertical: 5 },
  dot: { width: 10, height: 10 },
  dotPickup: { borderRadius: 5, backgroundColor: colors.primary },
  dotDrop: { borderRadius: 2, backgroundColor: colors.ink900 },
  line: { width: 1, flex: 1, minHeight: 24, backgroundColor: colors.border },
  text: { flex: 1, minWidth: 0, gap: spacing.sm + 2 },
  label: { ...typography.label, color: colors.ink600 },
  value: { ...typography.body, lineHeight: 22, color: colors.ink900, fontFamily: fonts.semibold },
  note: { ...typography.label, color: colors.ink600 },
})
