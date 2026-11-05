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
    <View accessible accessibilityLabel={`Pickup ${originAddress ?? 'not set'}. ${drop.label} ${drop.value}.`}>
      {/* One row per stop, each with its own marker, so the drop marker sits level with the "Drop" label however long the pickup address is. */}
      <View style={styles.row}>
        <View style={styles.markerCol}>
          <View style={[styles.dot, styles.dotPickup]} />
          <View style={styles.line} />
        </View>
        <View style={[styles.text, styles.pickupText]}>
          <Text style={styles.label}>Pickup</Text>
          <Text style={styles.value} numberOfLines={3}>{originAddress ?? 'Pickup location'}</Text>
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.markerCol}>
          <View style={[styles.dot, styles.dotDrop]} />
        </View>
        <View style={styles.text}>
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
  markerCol: { width: 10, alignItems: 'center', paddingTop: 6 },
  dot: { width: 10, height: 10 },
  dotPickup: { borderRadius: 5, backgroundColor: colors.primary },
  dotDrop: { borderRadius: 2, backgroundColor: colors.ink900 },
  line: { width: 1, flex: 1, marginTop: 2, backgroundColor: colors.border },
  text: { flex: 1, minWidth: 0 },
  pickupText: { paddingBottom: spacing.sm + 4 },
  label: { ...typography.label, color: colors.ink600 },
  value: { ...typography.body, lineHeight: 22, color: colors.ink900, fontFamily: fonts.semibold },
  note: { ...typography.label, color: colors.ink600 },
})
