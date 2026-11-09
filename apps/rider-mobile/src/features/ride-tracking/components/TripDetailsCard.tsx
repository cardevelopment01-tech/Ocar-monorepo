import { StyleSheet, Text, View } from 'react-native'
import { dropDisplay, font, h } from '@ocar/mobile-shared'
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
      <View style={styles.textCol}>
        {/* One row per stop with its own marker, so the drop marker sits level with "Drop" whatever the pickup length. */}
        <View style={styles.stopRow}>
          <View style={styles.markerCol}>
            <View style={[styles.dot, styles.dotPickup]} />
            <View style={styles.line} />
          </View>
          <View style={[styles.stopText, styles.pickupText]}>
            <Text style={styles.label}>Pickup</Text>
            <Text style={styles.value} numberOfLines={3}>{ride.originAddress ?? 'Your location'}</Text>
          </View>
        </View>
        <View style={styles.stopRow}>
          <View style={styles.markerCol}>
            <View style={[styles.dot, styles.dotDrop]} />
          </View>
          <View style={styles.stopText}>
            <Text style={styles.label}>{drop.label}</Text>
            <Text style={styles.value} numberOfLines={3}>{drop.value}</Text>
            {drop.note ? <Text style={styles.note}>{drop.note}</Text> : null}
          </View>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 20, backgroundColor: h.chip },
  stopRow: { flexDirection: 'row', gap: 14 },
  markerCol: { width: 10, alignItems: 'center', paddingTop: 5 },
  stopText: { flex: 1, minWidth: 0 },
  pickupText: { paddingBottom: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotPickup: { backgroundColor: h.teal, boxShadow: '0 0 0 3px rgba(14,143,163,0.18)' },
  dotDrop: { backgroundColor: h.ivory, borderRadius: 3 },
  line: { width: 0, flex: 1, marginTop: 2, borderLeftWidth: 1.5, borderLeftColor: '#B3C0C3', borderStyle: 'dashed' },
  textCol: { flex: 1, minWidth: 0 },
  label: { fontFamily: font.sb, fontSize: 11.5, color: h.label },
  value: { fontFamily: font.b, fontSize: 14, color: h.ivory },
  note: { fontFamily: font.m, fontSize: 11.5, color: h.muted },
  fareCol: { alignItems: 'flex-end', flexShrink: 0 },
  fareValue: { fontFamily: font.xb, fontSize: 16, color: h.ivory, fontVariant: ['tabular-nums'] },
})
