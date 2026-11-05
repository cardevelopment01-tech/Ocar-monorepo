import { StyleSheet, Text, View } from 'react-native'
import { colors, dropDisplay, radii, spacing, typography, fonts } from '@ocar/mobile-shared'
import type { RideDetailExtra } from '../types'

export type TripDetailsCardProps = {
  ride: RideDetailExtra
  fare: string | null
}

// Matches web's RouteRow (apps/user/app/(main)/ride/[id]/page.tsx): a dot/line
// connector next to Pickup/Drop address blocks, fare tucked at the right --
// not shown standalone, only inside the collapsible "Trip details" section
// below, same as web keeps it out of the always-visible peek row. Rider-mobile
// previously had no address display at all for a ride with no stops (the
// StopTimeline-driven "Trip details" toggle only appeared when stops existed).
export function TripDetailsCard({ ride, fare }: TripDetailsCardProps) {
  // The real drop address for every ride type (a rental books one too); the package is a caption, never a stand-in.
  const drop = dropDisplay(ride)

  return (
    <View style={styles.row}>
      <View style={styles.dots}>
        <View style={[styles.dot, styles.dotPickup]} />
        <View style={styles.line} />
        <View style={[styles.dot, styles.dotDrop]} />
      </View>
      <View style={styles.textCol}>
        <View>
          <Text style={styles.label}>Pickup</Text>
          <Text style={styles.value} numberOfLines={3}>{ride.originAddress ?? 'Your location'}</Text>
        </View>
        <View>
          <Text style={styles.label}>{drop.label}</Text>
          <Text style={styles.value} numberOfLines={3}>{drop.value}</Text>
          {drop.note ? <Text style={styles.note}>{drop.note}</Text> : null}
        </View>
      </View>
      {fare ? (
        <View style={styles.fareCol}>
          <Text style={styles.label}>Est. fare</Text>
          <Text style={styles.fareValue}>{fare}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radii.xl, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  dots: { alignItems: 'center', gap: 2, alignSelf: 'stretch', paddingVertical: 3 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotPickup: { backgroundColor: colors.primary },
  dotDrop: { backgroundColor: colors.ink900 },
  line: { width: 1, flex: 1, minHeight: 20, backgroundColor: colors.border },
  textCol: { flex: 1, minWidth: 0, gap: spacing.sm },
  label: { ...typography.caption, fontSize: 11, color: colors.ink400, fontFamily: fonts.semibold },
  value: { ...typography.label, fontSize: 13, color: colors.ink900, fontFamily: fonts.semibold },
  note: { ...typography.caption, fontSize: 11, color: colors.ink600 },
  fareCol: { alignItems: 'flex-end', flexShrink: 0 },
  fareValue: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
})
