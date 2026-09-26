import { StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Button, colors, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import type { RideDetailSettled } from '../useActiveRide'

export type TripCompletionCardProps = {
  ride: RideDetailSettled
  collectedCash: number | null
  driverRating: number | null
  onBackToOnline: () => void
}

function fmt(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

// Ported from web's TripEnd.tsx (apps/driver/src/pages/ActiveRide/TripEnd.tsx):
// check-mark hero + route line, an earnings breakdown (fare / commission /
// net) instead of a single bare number, and a fare+rating stats row. The
// previous version here was a guessed "Trip complete / ₹X earned" card with
// none of that -- drivers had no way to see the commission split that
// actually explains the number they're looking at.
export function TripCompletionCard({ ride, collectedCash, driverRating, onBackToOnline }: TripCompletionCardProps) {
  const fare = parseFloat(ride.totalFinal ?? ride.totalEstimated ?? '0')
  const isCash = (ride.paymentChannel ?? 'cash') === 'cash'
  const realCommission = ride.commissionAmount != null ? parseFloat(ride.commissionAmount) : null
  const realEarning = ride.driverEarning != null ? parseFloat(ride.driverEarning) : null
  const commissionIsEstimate = realCommission == null
  const commission = realCommission ?? Math.round(fare * 0.15)
  const net = realEarning ?? parseFloat((fare - commission).toFixed(2))
  const isRental = ride.rideType === 'rental'

  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <View style={styles.checkCircle}>
          <Feather name="check" size={36} color={colors.inkInverse} />
        </View>
        <Text style={styles.heroTitle}>Trip Complete!</Text>
        <View style={styles.routeRow}>
          <Feather name="map-pin" size={11} color={colors.primary} />
          <Text style={styles.routeText} numberOfLines={1}>{ride.originAddress ?? '-'}</Text>
          {!isRental ? (
            <>
              <Feather name="arrow-right" size={10} color={colors.ink400} />
              <Text style={styles.routeText} numberOfLines={1}>{ride.destinationAddress ?? '-'}</Text>
            </>
          ) : (
            <Text style={styles.routeText}>Flexible route</Text>
          )}
        </View>
      </View>

      <View style={styles.earningsCard}>
        <Text style={styles.earningsLabel}>{isCash ? 'CASH COLLECTED' : 'YOU EARNED'}</Text>
        <Text style={styles.earningsAmount}>{fmt(isCash ? (collectedCash ?? fare) : net)}</Text>

        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Ride fare</Text>
          <Text style={styles.breakdownValue}>{fmt(fare)}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>
            {isCash ? `Commission (deducted from wallet${commissionIsEstimate ? ', est.' : ''})` : `Platform commission${commissionIsEstimate ? ' (est.)' : ''}`}
          </Text>
          <Text style={styles.breakdownValueNegative}>-{fmt(commission)}</Text>
        </View>
        <View style={[styles.breakdownRow, styles.breakdownTotal]}>
          <Text style={styles.breakdownLabelBold}>{isCash ? 'You keep' : 'Net earnings'}</Text>
          <Text style={styles.breakdownValueBold}>{fmt(isCash ? (collectedCash ?? fare) : net)}</Text>
        </View>

        {isCash ? (
          <Text style={styles.cashNote}>
            You collected this fare in cash. Commission has already been deducted from your wallet — no payout is due for this ride.
          </Text>
        ) : null}
      </View>

      <View style={styles.statsCard}>
        <View style={styles.statCol}>
          <Text style={styles.statValue}>{fmt(fare)}</Text>
          <Text style={styles.statLabel}>Fare</Text>
        </View>
        <View style={[styles.statCol, styles.statColBordered]}>
          <View style={styles.statRatingRow}>
            <Feather name="star" size={13} color={colors.warning} />
            <Text style={styles.statValue}>{driverRating != null ? driverRating.toFixed(1) : '-'}</Text>
          </View>
          <Text style={styles.statLabel}>Your rating</Text>
        </View>
      </View>

      <Button label="Back to online" onPress={onBackToOnline} />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  hero: { alignItems: 'center', gap: spacing.xs },
  checkCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.success,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
    shadowColor: colors.success, shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 6,
  },
  heroTitle: { fontSize: 26, fontFamily: fonts.bold, color: colors.ink900 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '90%' },
  routeText: { ...typography.caption, color: colors.ink600, flexShrink: 1 },
  earningsCard: { backgroundColor: colors.surface, borderRadius: 24, borderWidth: 1, borderColor: colors.border, padding: spacing.md + 4 },
  earningsLabel: { ...typography.caption, color: colors.ink400, fontFamily: fonts.bold, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: spacing.xs },
  earningsAmount: { fontSize: 40, fontFamily: fonts.bold, color: colors.primary, marginBottom: spacing.sm },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  breakdownLabel: { ...typography.caption, color: colors.ink600, flexShrink: 1, paddingRight: spacing.sm },
  breakdownValue: { ...typography.caption, color: colors.ink900, fontFamily: fonts.bold },
  breakdownValueNegative: { ...typography.caption, color: colors.error, fontFamily: fonts.bold },
  breakdownTotal: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.xs, paddingTop: spacing.xs + 2 },
  breakdownLabelBold: { ...typography.caption, color: colors.ink900, fontFamily: fonts.bold },
  breakdownValueBold: { ...typography.body, color: colors.primary, fontFamily: fonts.bold },
  cashNote: { ...typography.caption, color: colors.ink400, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  statsCard: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 24, borderWidth: 1, borderColor: colors.border, padding: spacing.md + 4 },
  statCol: { flex: 1, alignItems: 'center' },
  statColBordered: { borderLeftWidth: 1, borderLeftColor: colors.border },
  statRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statValue: { fontSize: 20, fontFamily: fonts.bold, color: colors.ink900 },
  statLabel: { ...typography.caption, color: colors.ink400, marginTop: 2 },
})
