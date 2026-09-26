import { StyleSheet, Text, View } from 'react-native'
import { Pressable } from 'react-native'
import { colors, formatCurrency, radii, spacing, typography, type RideDetail, fonts } from '@ocar/mobile-shared'
import { RouteRow } from './RouteRow'

const ACTIVE_STATUS_LABEL: Record<string, string> = {
  requested: 'Finding driver',
  accepted: 'Driver on the way',
  driver_arrived: 'Driver has arrived',
  in_progress: 'Trip in progress',
}

export type ActiveRideCardProps = {
  ride: RideDetail
  onOpen: () => void
}

// Matches web's ActiveRideCard (history/page.tsx): a "Live" pulse pill
// naming the exact ride stage, tinted primary card, same route row. Surfaces
// on the Upcoming tab above the scheduled list, same as web -- previously
// rider-mobile had no way to jump back into an in-progress ride from here.
export function ActiveRideCard({ ride, onOpen }: ActiveRideCardProps) {
  const fare = ride.totalEstimated != null ? formatCurrency(Math.round(parseFloat(ride.totalEstimated))) : null

  return (
    <Pressable onPress={onOpen} style={styles.wrapper} accessibilityRole="button">
      <View style={styles.card}>
        <View style={styles.topRow}>
          <View style={styles.livePill}>
            <View style={styles.pulseDot} />
            <Text style={styles.liveText}>Live · {ACTIVE_STATUS_LABEL[ride.status] ?? 'Active'}</Text>
          </View>
          {fare ? <Text style={styles.fare}>{fare}</Text> : null}
        </View>
        <RouteRow origin={ride.originAddress ?? '-'} destination={ride.destinationAddress ?? '-'} />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  card: { backgroundColor: colors.primarySubtle, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.primaryLight, padding: spacing.md, gap: spacing.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.inkInverse },
  liveText: { ...typography.caption, fontSize: 11, color: colors.inkInverse, fontFamily: fonts.bold },
  fare: { ...typography.label, fontSize: 14, color: colors.ink900, fontFamily: fonts.bold },
})
