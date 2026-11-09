import { useEffect, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Button, buildTripFacts, dropDisplay, font, h, maybeRequestReview, shadow, spacing } from '@ocar/mobile-shared'
import { IconButton } from '@/components/ui'
import { fetchProfile } from '@/features/profile/api'
import { DriverAvatar, driverViewFromRide } from '@/features/ride-tracking/components/DriverIdentity'
import { RideMapView } from '@/features/ride-tracking/components/RideMapView'
import { StopTimeline } from '@/features/ride-tracking/components/StopTimeline'
import { fetchRouteLeg } from '@/features/ride-tracking/api'
import type { RideDetailExtra } from '@/features/ride-tracking/types'
import { RatingSection } from './RatingSection'
import {
  buildInvoiceRows, buildTimeline, formatMoney, formatTripWhen, paymentState, tripTitle,
} from './tripSummaryModel'

// Support has no in-app entry on mobile yet; email is the channel the web site already publishes
// (apps/user/lib/company.ts). The ride id in the subject lets support find the trip.
const SUPPORT_EMAIL = 'support@ocarindia.com'
const CASH_POLL_MS = 15_000
const MAP_HEIGHT = 196
// Marker pins draw above their coordinate, so the top needs ~a pin of room; the default full-screen padding
// (80 top + 80 bottom) is bigger than this whole map and makes it zoom out to the continent.
const MAP_FIT_PADDING = { top: 56, right: 48, bottom: 28, left: 48 }

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

  // The best moment to ask for a store rating: the rider just rated a completed trip. The helper decides whether
  // they are eligible (rides, days, cooldown) and the OS decides whether the card really shows.
  const handleRated = () => {
    onRefresh()
    if (completed) {
      void maybeRequestReview({ role: 'rider', delayMs: 1500, getLifetimeRides: async () => (await fetchProfile()).total_rides })
    }
  }

  const goHome = () => router.replace('/(tabs)/home')
  // Opened straight after the ride there is nothing to go back to; from My Trips there is.
  const canGoBack = router.canGoBack()
  const back = () => (canGoBack ? router.back() : goHome())

  const invoice = buildInvoiceRows(ride)
  const fareValue = completed ? invoice.total : Number(ride.totalFinal ?? 0)
  const showFare = fareValue > 0
  const fareText = formatMoney(fareValue)
  const when = formatTripWhen(ride.completedAt ?? ride.requestedAt)
  const facts = completed ? buildTripFacts(ride) : []
  const timeline = buildTimeline(ride)
  // The drop is always the real address (a rental books one too); the package is only a caption under it.
  const drop = dropDisplay(ride)
  const driverView = driverViewFromRide(ride)
  const hasDriver = completed && ride.driverId != null
  // Only label a fee that exists: a free cancellation has no fare to caption.
  const fareCaption = !completed && showFare ? 'Cancellation fee' : null

  const emailSupport = (subject: string) =>
    void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Ride #${ride.id} - ${subject}`)}`)

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <IconButton icon="arrow-left" label="Back" onPress={back} />
        <Text style={styles.headerTitle} accessibilityRole="header">Trip details</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + (canGoBack ? spacing.lg : 96) }]}
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
          <LinearGradient colors={['#EEF8F9', '#FFFFFF']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 0.9 }} style={styles.heroTint} />
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
              <Feather name={completed ? 'check' : 'x'} size={13} color={completed ? h.live : h.danger} />
              <Text style={[styles.pillText, { color: completed ? h.live : h.danger }]}>{completed ? 'Completed' : ride.status === 'no_drivers' ? 'No drivers found' : 'Cancelled'}</Text>
            </View>
            {fareCaption ? <Text style={styles.sub}>{fareCaption}</Text> : null}
            {/* The receipt's Payment row says this when there are fare rows; only repeat it when there are none. */}
            {pay && pay.kind === 'paid' && invoice.rows.length === 0 ? <Text style={styles.sub}>{pay.text}</Text> : null}
          </View>
          {pay && pay.kind === 'cash_due' ? (
            <View style={styles.dueStrip} accessibilityRole="alert">
              <Feather name="alert-circle" size={18} color={h.goldInk} />
              <Text style={styles.dueText}>{pay.text}</Text>
            </View>
          ) : null}
        </View>

        {/* Route */}
        <View style={styles.section}>
          {/* One row per stop with its own marker, so the drop marker sits level with "Drop" however long the pickup is. */}
          <View>
          <View style={styles.routeRow}>
            <View style={styles.markerCol}>
              <View style={[styles.dot, styles.dotPickup]} />
              <View style={styles.line} />
            </View>
            <View style={[styles.routeText, styles.pickupText]}>
              <Text style={styles.routeLabel}>Pickup</Text>
              <Text style={styles.routeValue} numberOfLines={3}>{ride.originAddress ?? 'Pickup location'}</Text>
            </View>
          </View>
          <View style={styles.routeRow}>
            <View style={styles.markerCol}>
              <View style={[styles.dot, styles.dotDrop]} />
            </View>
            <View style={styles.routeText}>
              <Text style={styles.routeLabel}>{drop.label}</Text>
              <Text style={styles.routeValue} numberOfLines={3}>{drop.value}</Text>
              {drop.note ? <Text style={styles.routeNote}>{drop.note}</Text> : null}
            </View>
          </View>
          </View>
          {ride.stops.length > 0 ? <StopTimeline stops={ride.stops} /> : null}
        </View>

        {/* When it ran and how far: start, end, distance, time taken. */}
        {facts.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Trip summary</Text>
            <View style={styles.receipt}>
              {facts.map((f) => (
                <View key={f.key} style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>{f.label}</Text>
                  <Text style={styles.receiptAmount}>{f.value}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Fare receipt: label and detail left, amount right in tabular figures. */}
        {completed && invoice.rows.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Fare receipt</Text>
            <View style={styles.receipt}>
              {invoice.rows.map((row) => (
                <View key={row.key} style={styles.receiptRow}>
                  <View style={styles.flex}>
                    <Text style={styles.receiptLabel}>{row.label}</Text>
                    {row.detail ? <Text style={styles.receiptDetail}>{row.detail}</Text> : null}
                  </View>
                  <Text style={styles.receiptAmount} maxFontSizeMultiplier={1.3}>{row.negative ? `−${formatMoney(row.amount)}` : formatMoney(row.amount)}</Text>
                </View>
              ))}
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{invoice.discount > 0 ? 'You paid' : 'Total'}</Text>
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
          <View style={styles.listCard}>
            <Pressable
              onPress={() => setBreakdownOpen((o) => !o)}
              accessibilityRole="button"
              accessibilityState={{ expanded: breakdownOpen }}
              accessibilityLabel="Time breakdown"
              style={styles.listRow}
            >
              <Text style={styles.listLabel}>Time breakdown</Text>
              <Feather name={breakdownOpen ? 'chevron-up' : 'chevron-down'} size={20} color={h.faint} />
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
          <View style={styles.section}>
            <View style={styles.driverRow}>
              <DriverAvatar view={driverView} photo={ride.driverPhoto} size="md" />
              <View style={styles.flex}>
                <Text style={styles.driverName} numberOfLines={1}>{driverView.name}</Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {driverView.ratingText ? `${driverView.ratingText} rating · ` : ''}{driverView.vehicleLine}
                </Text>
                {driverView.plate ? <Text style={styles.plate} numberOfLines={1}>{driverView.plate}</Text> : null}
              </View>
            </View>
            <RatingSection rideId={ride.id} driverName={driverView.name} existing={ride.userRatingGiven} onRated={handleRated} />
          </View>
        ) : null}

        {/* Help + ride id */}
        <View style={styles.listCard}>
          {completed ? (
            <Pressable onPress={() => emailSupport('receipt')} accessibilityRole="link" accessibilityLabel="Email a receipt request" style={styles.listRow}>
              <Text style={styles.listLabel}>Download receipt</Text>
              <Feather name="chevron-right" size={20} color={h.faint} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => emailSupport('help')} accessibilityRole="link" accessibilityLabel="Get help with this trip, email support" style={[styles.listRow, completed ? styles.ruled : null]}>
            <Text style={styles.listLabel}>Get help with this trip</Text>
            <Feather name="chevron-right" size={20} color={h.faint} />
          </Pressable>
        </View>
        <Text style={styles.rideId} selectable>Ride #{ride.id}</Text>
      </ScrollView>

      {!canGoBack ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Button variant="cta" label="Back to home" onPress={goHome} />
        </View>
      ) : null}
    </View>
  )
}

const hair = { borderTopWidth: 1, borderTopColor: h.line07 } as const

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: h.canvas },
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingBottom: 12 },
  headerTitle: { fontFamily: font.b, fontSize: 20, letterSpacing: -0.2, color: h.ivory },
  content: { paddingHorizontal: 18, gap: 14 },
  map: { height: MAP_HEIGHT, borderRadius: 24, overflow: 'hidden', backgroundColor: h.chip },

  section: { backgroundColor: h.surface, borderRadius: 24, borderWidth: 1, borderColor: h.line07, padding: 18, gap: 14, boxShadow: shadow.sm },
  listCard: { backgroundColor: h.surface, borderRadius: 22, borderWidth: 1, borderColor: h.line07, boxShadow: shadow.sm, overflow: 'hidden' },
  heroTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 24 },
  ruled: hair,
  headRow: { gap: 4 },
  title: { fontFamily: font.b, fontSize: 20, lineHeight: 26, color: h.ivory },
  sub: { fontFamily: font.m, fontSize: 13, color: h.muted },
  fare: { fontFamily: font.xb, fontSize: 40, lineHeight: 46, letterSpacing: -1, color: h.ivory, fontVariant: ['tabular-nums'] },
  statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, height: 26, borderRadius: 13 },
  pillOk: { backgroundColor: '#DDF5EA' },
  pillBad: { backgroundColor: h.dangerWash },
  pillText: { fontFamily: font.b, fontSize: 12 },
  dueStrip: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: h.goldWash, borderRadius: 16, padding: 14 },
  dueText: { fontFamily: font.b, fontSize: 14, color: h.ivory, flex: 1 },

  routeRow: { flexDirection: 'row', gap: 14 },
  markerCol: { width: 10, alignItems: 'center', paddingTop: 7 },
  pickupText: { paddingBottom: 14 },
  dot: { width: 10, height: 10 },
  dotPickup: { borderRadius: 5, backgroundColor: h.teal, boxShadow: '0 0 0 3px rgba(14,143,163,0.18)' },
  dotDrop: { borderRadius: 3, backgroundColor: h.ivory },
  line: { width: 0, flex: 1, marginTop: 2, borderLeftWidth: 1.5, borderLeftColor: '#B3C0C3', borderStyle: 'dashed' },
  routeText: { flex: 1, minWidth: 0 },
  routeLabel: { fontFamily: font.sb, fontSize: 11.5, color: h.label },
  routeValue: { fontFamily: font.b, fontSize: 14.5, lineHeight: 21, color: h.ivory },
  routeNote: { fontFamily: font.m, fontSize: 12.5, color: h.muted },

  sectionTitle: { fontFamily: font.sb, fontSize: 14, color: h.ivory },
  receipt: { gap: 12 },
  receiptRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  receiptLabel: { fontFamily: font.sb, fontSize: 14.5, lineHeight: 21, color: h.ivory },
  receiptDetail: { fontFamily: font.m, fontSize: 12.5, color: h.muted },
  receiptAmount: { fontFamily: font.b, fontSize: 14.5, lineHeight: 21, color: h.ivory, fontVariant: ['tabular-nums'] },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, backgroundColor: h.tealWash, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, marginTop: 4 },
  totalLabel: { fontFamily: font.b, fontSize: 16, color: h.ivory, flex: 1 },
  totalAmount: { fontFamily: font.xb, fontSize: 24, lineHeight: 30, letterSpacing: -0.4, color: h.ivory, fontVariant: ['tabular-nums'] },

  listRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 58, paddingHorizontal: 18 },
  listLabel: { fontFamily: font.sb, fontSize: 15, color: h.ivory, flex: 1 },
  timeline: { paddingHorizontal: 18, paddingBottom: 16, gap: 12 },
  timelineRow: { flexDirection: 'row', gap: 16 },
  timelineTime: { fontFamily: font.b, fontSize: 14.5, lineHeight: 21, width: 72, color: h.ivory, fontVariant: ['tabular-nums'] },

  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  driverName: { fontFamily: font.b, fontSize: 16, color: h.ivory },
  plate: { fontFamily: font.xb, fontSize: 13, letterSpacing: 1, color: h.ivory },

  rideId: { fontFamily: font.m, fontSize: 12.5, color: h.faint, textAlign: 'center', paddingVertical: 16 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 10, backgroundColor: h.canvas },
})
