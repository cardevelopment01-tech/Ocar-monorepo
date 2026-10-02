import { useEffect, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Button, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { DriverAvatar, driverViewFromRide } from '@/features/ride-tracking/components/DriverIdentity'
import { RideMapView } from '@/features/ride-tracking/components/RideMapView'
import { StopTimeline } from '@/features/ride-tracking/components/StopTimeline'
import { fetchRouteLeg } from '@/features/ride-tracking/api'
import type { RideDetailExtra } from '@/features/ride-tracking/types'
import { RatingSection } from './RatingSection'
import {
  buildInvoiceRows, buildTimeline, formatMoney, formatTripWhen, paymentState, tripMetrics, tripTitle,
} from './tripSummaryModel'

// Support has no in-app entry on mobile yet; email is the channel the web site already publishes
// (apps/user/lib/company.ts). The ride id in the subject lets support find the trip.
const SUPPORT_EMAIL = 'support@ocarindia.com'
const CASH_POLL_MS = 15_000
const MAP_HEIGHT = 168
// Marker pins draw above their coordinate, so the top needs ~a pin of room; the default full-screen padding
// (80 top + 80 bottom) is bigger than this whole map and makes it zoom out to the continent.
const MAP_FIT_PADDING = { top: 64, right: 48, bottom: 28, left: 48 }

export type TripSummaryProps = {
  ride: RideDetailExtra
  // Refetch the ride. The backend never pushes "cash collected" to the rider, so a cash-due
  // trip polls this until the driver confirms.
  onRefresh: () => void
}

export function TripSummary({ ride, onRefresh }: TripSummaryProps) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const completed = ride.status === 'completed'
  const pay = completed ? paymentState(ride) : null
  const cashDue = pay?.kind === 'cash_due'
  const [breakdownOpen, setBreakdownOpen] = useState(false)

  useEffect(() => {
    if (!cashDue) return
    const t = setInterval(onRefresh, CASH_POLL_MS)
    return () => clearInterval(t)
  }, [cashDue, onRefresh])

  // Route line for the preview map. Best effort: without it the map still shows both pins.
  const hasMap = ride.rideType !== 'rental' && ride.destLat != null && ride.destLng != null
  const [route, setRoute] = useState<[number, number][]>([])
  useEffect(() => {
    if (!hasMap) return
    let live = true
    fetchRouteLeg(ride.originLat, ride.originLng, ride.destLat!, ride.destLng!, false)
      .then((leg) => { if (live) setRoute(leg.polyline) })
      .catch(() => {})
    return () => { live = false }
  }, [hasMap, ride.originLat, ride.originLng, ride.destLat, ride.destLng])

  const goHome = () => router.replace('/(tabs)/home')
  // Opened straight after the ride there is nothing to go back to; from My Trips there is.
  const canGoBack = router.canGoBack()
  const back = () => (canGoBack ? router.back() : goHome())

  const invoice = buildInvoiceRows(ride)
  const fareValue = completed ? invoice.total : Number(ride.totalFinal ?? 0)
  const showFare = fareValue > 0
  const fareText = formatMoney(fareValue)
  const when = formatTripWhen(ride.completedAt ?? ride.requestedAt)
  const metrics = tripMetrics(ride)
  const timeline = buildTimeline(ride)
  const dropLabel = ride.rideType === 'round_trip' ? 'Drop and return' : ride.rideType === 'rental' ? 'Route' : 'Drop'
  const dropValue = ride.rideType === 'rental'
    ? (ride.tripHours ? `${ride.tripHours}h rental, flexible` : 'Hourly rental, flexible')
    : (ride.destinationAddress ?? 'Destination')
  const driverView = driverViewFromRide(ride)
  const hasDriver = completed && ride.driverId != null
  // Only label a fee that exists: a free cancellation has no fare to caption.
  const fareCaption = !completed && showFare ? 'Cancellation fee' : null

  const emailSupport = (subject: string) =>
    void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Ride #${ride.id} - ${subject}`)}`)

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={back} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.ink900} />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">Trip details</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + (canGoBack ? spacing.lg : 96) }}
        showsVerticalScrollIndicator={false}
      >
        {/* Route preview: non-interactive so it never fights the scroll. */}
        {hasMap ? (
          <View style={styles.map} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <RideMapView
              pickup={[ride.originLat, ride.originLng]}
              drop={[ride.destLat!, ride.destLng!]}
              driverPos={null}
              routePoints={route}
              edgePadding={MAP_FIT_PADDING}
              showDrop
              stops={ride.stops.map((s): [number, number] => [s.lat, s.lng])}
            />
          </View>
        ) : null}

        {/* Headline: what happened on the left, what it cost on the right. */}
        <View style={styles.section}>
          <View style={styles.headRow}>
            <View style={styles.flex}>
              <Text style={styles.title} numberOfLines={2}>{tripTitle(ride)}</Text>
              {when ? <Text style={styles.sub}>{when}</Text> : null}
            </View>
            {showFare ? (
              <Text
                style={styles.fare}
                maxFontSizeMultiplier={1.3}
                accessibilityLabel={`${fareCaption ?? 'Fare'} ${fareText}`}
              >
                {fareText}
              </Text>
            ) : null}
          </View>
          <View style={styles.statusRow}>
            <View style={[styles.pill, completed ? styles.pillOk : styles.pillBad]}>
              <Feather name={completed ? 'check' : 'x'} size={13} color={completed ? colors.success : colors.error} />
              <Text style={[styles.pillText, { color: completed ? colors.success : colors.error }]}>{completed ? 'Completed' : ride.status === 'no_drivers' ? 'No drivers found' : 'Cancelled'}</Text>
            </View>
            {fareCaption ? <Text style={styles.sub}>{fareCaption}</Text> : null}
            {/* The receipt's Payment row says this when there are fare rows; only repeat it when there are none. */}
            {pay && pay.kind === 'paid' && invoice.rows.length === 0 ? <Text style={styles.sub}>{pay.text}</Text> : null}
          </View>
          {pay && pay.kind === 'cash_due' ? (
            <View style={styles.dueStrip} accessibilityRole="alert">
              <Feather name="alert-circle" size={18} color={colors.warning} />
              <Text style={styles.dueText}>{pay.text}</Text>
            </View>
          ) : null}
        </View>

        {/* Route */}
        <View style={[styles.section, styles.ruled]}>
          <View style={styles.routeRow}>
            <View style={styles.dots}>
              <View style={[styles.dot, styles.dotPickup]} />
              <View style={styles.line} />
              <View style={[styles.dot, styles.dotDrop]} />
            </View>
            <View style={styles.routeText}>
              <View>
                <Text style={styles.routeLabel}>Pickup</Text>
                <Text style={styles.routeValue} numberOfLines={2}>{ride.originAddress ?? 'Pickup location'}</Text>
              </View>
              <View>
                <Text style={styles.routeLabel}>{dropLabel}</Text>
                <Text style={styles.routeValue} numberOfLines={2}>{dropValue}</Text>
              </View>
            </View>
          </View>
          {ride.stops.length > 0 ? <StopTimeline stops={ride.stops} /> : null}
          {metrics && completed ? <Text style={styles.sub}>{metrics}</Text> : null}
        </View>

        {/* Fare receipt: label and detail left, amount right in tabular figures. */}
        {completed && invoice.rows.length > 0 ? (
          <View style={[styles.section, styles.ruled]}>
            <Text style={styles.sectionTitle}>Fare receipt</Text>
            <View style={styles.receipt}>
              {invoice.rows.map((row) => (
                <View key={row.key} style={styles.receiptRow}>
                  <View style={styles.flex}>
                    <Text style={styles.receiptLabel}>{row.label}</Text>
                    {row.detail ? <Text style={styles.receiptDetail}>{row.detail}</Text> : null}
                  </View>
                  <Text style={styles.receiptAmount} maxFontSizeMultiplier={1.3}>{formatMoney(row.amount)}</Text>
                </View>
              ))}
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalAmount} maxFontSizeMultiplier={1.3}>{formatMoney(invoice.total)}</Text>
            </View>
            {pay ? (
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Payment</Text>
                <Text style={styles.receiptAmount}>{pay.kind === 'paid' ? pay.text : 'Cash, due to driver'}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Time breakdown: only exists when a round trip ran past its booked window. */}
        {timeline ? (
          <View style={styles.ruled}>
            <Pressable
              onPress={() => setBreakdownOpen((o) => !o)}
              accessibilityRole="button"
              accessibilityState={{ expanded: breakdownOpen }}
              accessibilityLabel="Time breakdown"
              style={styles.listRow}
            >
              <Text style={styles.listLabel}>Time breakdown</Text>
              <Feather name={breakdownOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.ink600} />
            </Pressable>
            {breakdownOpen ? (
              <View style={styles.timeline}>
                {timeline.map((step) => (
                  <View key={step.key} style={styles.timelineRow}>
                    <Text style={styles.timelineTime}>{step.time}</Text>
                    <View style={styles.flex}>
                      <Text style={styles.receiptLabel}>{step.label}</Text>
                      {step.note ? <Text style={styles.receiptDetail}>{step.note}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Driver + rating */}
        {hasDriver ? (
          <View style={[styles.section, styles.ruled]}>
            <View style={styles.driverRow}>
              <DriverAvatar view={driverView} photo={ride.driverPhoto} size="md" />
              <View style={styles.flex}>
                <Text style={styles.driverName} numberOfLines={1}>{driverView.name}</Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {driverView.ratingText ? `${driverView.ratingText} rating · ` : ''}{driverView.vehicleLine}{driverView.plate ? ` · ${driverView.plate}` : ''}
                </Text>
              </View>
            </View>
            <RatingSection rideId={ride.id} driverName={driverView.name} existing={ride.userRatingGiven} onRated={onRefresh} />
          </View>
        ) : null}

        {/* Help + ride id */}
        <View style={styles.ruled}>
          {completed ? (
            <Pressable onPress={() => emailSupport('receipt')} accessibilityRole="link" accessibilityLabel="Email a receipt request" style={styles.listRow}>
              <Text style={styles.listLabel}>Download receipt</Text>
              <Feather name="chevron-right" size={20} color={colors.ink600} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => emailSupport('help')} accessibilityRole="link" accessibilityLabel="Get help with this trip, email support" style={[styles.listRow, completed ? styles.ruled : null]}>
            <Text style={styles.listLabel}>Get help with this trip</Text>
            <Feather name="chevron-right" size={20} color={colors.ink600} />
          </Pressable>
        </View>
        <Text style={styles.rideId} selectable>Ride #{ride.id}</Text>
      </ScrollView>

      {!canGoBack ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Button label="Back to home" onPress={goHome} />
        </View>
      ) : null}
    </View>
  )
}

const hair = { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } as const

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typography.headline, color: colors.ink900 },
  map: { height: MAP_HEIGHT, backgroundColor: colors.surface3 },

  section: { paddingHorizontal: spacing.md + 4, paddingVertical: spacing.md + 4, gap: spacing.sm + 4 },
  ruled: hair,
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: { ...typography.title, fontSize: 20, lineHeight: 26, color: colors.ink900 },
  sub: { ...typography.label, color: colors.ink600 },
  fare: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: colors.ink900, fontVariant: ['tabular-nums'] },
  statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.full },
  pillOk: { backgroundColor: colors.successLight },
  pillBad: { backgroundColor: colors.errorLight },
  pillText: { fontFamily: fonts.semibold, fontSize: 12 },
  dueStrip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.warningLight, borderRadius: radii.lg, padding: spacing.sm + 4 },
  dueText: { ...typography.label, fontSize: 14, fontFamily: fonts.bold, color: colors.ink900, flex: 1 },

  routeRow: { flexDirection: 'row', gap: spacing.sm + 4 },
  dots: { alignItems: 'center', paddingVertical: 5 },
  dot: { width: 10, height: 10 },
  dotPickup: { borderRadius: 5, backgroundColor: colors.primary },
  dotDrop: { borderRadius: 2, backgroundColor: colors.ink900 },
  line: { width: 1, flex: 1, minHeight: 24, backgroundColor: colors.border },
  routeText: { flex: 1, minWidth: 0, gap: spacing.md },
  routeLabel: { ...typography.label, color: colors.ink600 },
  routeValue: { ...typography.body, lineHeight: 22, color: colors.ink900, fontFamily: fonts.semibold },

  sectionTitle: { ...typography.title, fontSize: 16, color: colors.ink900 },
  receipt: { gap: spacing.sm + 4 },
  receiptRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  receiptLabel: { ...typography.body, lineHeight: 22, color: colors.ink900 },
  receiptDetail: { ...typography.label, color: colors.ink600 },
  receiptAmount: { ...typography.body, lineHeight: 22, color: colors.ink900, fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] },
  totalRow: { ...hair, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md, paddingTop: spacing.md },
  totalLabel: { ...typography.title, color: colors.ink900, flex: 1 },
  totalAmount: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, color: colors.ink900, fontVariant: ['tabular-nums'] },

  listRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.md + 4 },
  listLabel: { ...typography.body, fontFamily: fonts.semibold, color: colors.ink900, flex: 1 },
  timeline: { paddingHorizontal: spacing.md + 4, paddingBottom: spacing.md, gap: spacing.sm + 4 },
  timelineRow: { flexDirection: 'row', gap: spacing.md },
  timelineTime: { ...typography.body, lineHeight: 22, width: 72, color: colors.ink900, fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] },

  driverRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  driverName: { ...typography.title, fontSize: 16, color: colors.ink900 },

  rideId: { ...typography.label, color: colors.ink600, textAlign: 'center', paddingVertical: spacing.md },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: colors.surface },
})
