import { StyleSheet, Text, View } from 'react-native'
import { font, h } from '@ocar/mobile-shared'
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
  const dropLabel = ride.rideType === 'round_trip' ? 'Drop & return' : ride.rideType === 'rental' ? 'Route' : 'Drop'
  const dropValue = ride.rideType === 'rental'
    ? (ride.tripHours ? `${ride.tripHours}h city ride · flexible` : 'Hourly city ride · flexible')
    : (ride.destinationAddress ?? 'Destination')

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
          <Text style={styles.value} numberOfLines={1}>{ride.originAddress ?? 'Your location'}</Text>
        </View>
        <View>
          <Text style={styles.label}>{dropLabel}</Text>
          <Text style={styles.value} numberOfLines={1}>{dropValue}</Text>
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
  dots: { alignItems: 'center', gap: 2, alignSelf: 'stretch', paddingVertical: 3 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotPickup: { backgroundColor: h.teal, boxShadow: '0 0 0 3px rgba(14,143,163,0.18)' },
  dotDrop: { backgroundColor: h.ivory, borderRadius: 3 },
  line: { width: 0, flex: 1, minHeight: 20, borderLeftWidth: 1.5, borderLeftColor: '#B3C0C3', borderStyle: 'dashed' },
  textCol: { flex: 1, minWidth: 0, gap: 12 },
  label: { fontFamily: font.sb, fontSize: 11.5, color: h.label },
  value: { fontFamily: font.b, fontSize: 14, color: h.ivory },
  fareCol: { alignItems: 'flex-end', flexShrink: 0 },
  fareValue: { fontFamily: font.xb, fontSize: 16, color: h.ivory, fontVariant: ['tabular-nums'] },
})
