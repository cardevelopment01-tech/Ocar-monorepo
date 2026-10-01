import { StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import Animated, { Easing, FadeIn, ReduceMotion, ZoomIn } from 'react-native-reanimated'
import { Button, colors, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
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
// check-mark hero + route line, and an earnings breakdown (fare / commission /
// net) instead of a single bare number -- drivers need the commission split that
// actually explains the number they're looking at. The fare is shown once as the
// breakdown's first row; it used to repeat in a separate stats card.
//
// The check lands with one short scale-in (a trip finishing is the rare success moment
// that earns it); everything else is already there.
export function TripCompletionCard({ ride, collectedCash, driverRating, onBackToOnline }: TripCompletionCardProps) {
  const fare = parseFloat(ride.totalFinal ?? ride.totalEstimated ?? '0')
  const isCash = (ride.paymentChannel ?? 'cash') === 'cash'
  const realCommission = ride.commissionAmount != null ? parseFloat(ride.commissionAmount) : null
  const realEarning = ride.driverEarning != null ? parseFloat(ride.driverEarning) : null
  const commissionIsEstimate = realCommission == null
  const commission = realCommission ?? Math.round(fare * 0.15)
  const net = realEarning ?? parseFloat((fare - commission).toFixed(2))
  const isRental = ride.rideType === 'rental'
  const route = isRental
    ? `${ride.originAddress ?? '-'} · Flexible route`
    : `${ride.originAddress ?? '-'} → ${ride.destinationAddress ?? '-'}`
  const headline = fmt(isCash ? (collectedCash ?? fare) : net)
  // Only when overtime was actually billed, so ordinary trips look exactly as before. The line
  // ties the live clock the driver watched to the number they are paid on.
  const overtime = (ride.overtimeMin ?? 0) > 0 && ride.overtimeFare != null
    ? { min: ride.overtimeMin as number, fare: ride.overtimeFare }
    : null

  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <Animated.View
          entering={ZoomIn.duration(260).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.System)}
          style={styles.checkCircle}
        >
          <Feather name="check" size={36} color={colors.inkInverse} />
        </Animated.View>
        <Text style={styles.heroTitle}>Trip complete</Text>
        <Text style={styles.route} numberOfLines={2}>{route}</Text>
      </View>

      <Animated.View entering={FadeIn.duration(220).delay(80).reduceMotion(ReduceMotion.System)} style={styles.earningsCard}>
        <Text style={styles.earningsLabel}>{isCash ? 'Cash collected' : 'You earned'}</Text>
        <Text style={styles.earningsAmount}>{headline}</Text>

        <View style={styles.breakdown}>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Ride fare</Text>
            <Text style={styles.breakdownValue}>{fmt(fare)}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>
              {isCash ? `Commission, deducted from wallet${commissionIsEstimate ? ' (est.)' : ''}` : `Platform commission${commissionIsEstimate ? ' (est.)' : ''}`}
            </Text>
            <Text style={styles.breakdownValue}>-{fmt(commission)}</Text>
          </View>
          {overtime ? (
            // Already inside the fare above: a caption, not another amount to add up.
            <Text style={styles.overtimeNote}>
              Booked {ride.tripHours}h · Overtime {overtime.min} min {fmt(overtime.fare)}
            </Text>
          ) : null}
          <View style={[styles.breakdownRow, styles.breakdownTotal]}>
            <Text style={styles.breakdownLabelBold}>{isCash ? 'You keep' : 'Net earnings'}</Text>
            <Text style={styles.breakdownValueBold}>{headline}</Text>
          </View>
        </View>

        {isCash ? (
          <Text style={styles.cashNote}>
            You collected this fare in cash. Commission has already been deducted from your wallet, so no payout is due for this ride.
          </Text>
        ) : null}
      </Animated.View>

      {driverRating != null ? (
        <View style={styles.ratingRow} accessibilityLabel={`Your rating ${driverRating.toFixed(1)}`}>
          <Feather name="star" size={14} color={colors.warning} />
          <Text style={styles.ratingText}>Your rating {driverRating.toFixed(1)}</Text>
        </View>
      ) : null}

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
  heroTitle: { ...typography.display, color: colors.ink900 },
  route: { ...typography.label, color: colors.ink600, textAlign: 'center', maxWidth: '92%' },
  earningsCard: { backgroundColor: colors.surface, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.md + 4 },
  earningsLabel: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold },
  earningsAmount: { fontSize: 40, lineHeight: 48, fontFamily: fonts.bold, color: colors.primary, marginBottom: spacing.sm },
  breakdown: { gap: spacing.xs + 2 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  breakdownLabel: { ...typography.label, color: colors.ink600, flexShrink: 1 },
  breakdownValue: { ...typography.label, color: colors.ink900, fontFamily: fonts.bold },
  overtimeNote: { ...typography.label, color: colors.ink600 },
  breakdownTotal: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: spacing.xs, paddingTop: spacing.sm },
  breakdownLabelBold: { ...typography.body, lineHeight: 22, color: colors.ink900, fontFamily: fonts.bold },
  breakdownValueBold: { ...typography.body, lineHeight: 22, color: colors.primary, fontFamily: fonts.bold },
  cashNote: { ...typography.label, color: colors.ink600, marginTop: spacing.md - 4, paddingTop: spacing.md - 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  ratingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2 },
  ratingText: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold },
})
