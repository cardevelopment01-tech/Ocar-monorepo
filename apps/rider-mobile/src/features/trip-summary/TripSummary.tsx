import { useEffect, useRef, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, FadeInDown, ZoomIn, useReducedMotion } from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Button, buildTripFacts, dropDisplay, font, h, maybeRequestReview, shadow, spacing } from '@ocar/mobile-shared'
import { Chip, IconButton } from '@/components/ui'
import { fetchProfile } from '@/features/profile/api'
import { DriverAvatar, PlateBadge, driverViewFromRide } from '@/features/ride-tracking/components/DriverIdentity'
import { RideMapView } from '@/features/ride-tracking/components/RideMapView'
import { StopTimeline } from '@/features/ride-tracking/components/StopTimeline'
import { fetchRouteLeg } from '@/features/ride-tracking/api'
import type { RideDetailExtra } from '@/features/ride-tracking/types'
import { RatingSection } from './RatingSection'
import { useReturnCabSaving } from './ReturnCabPanels'
import { endedHeadline } from './endedHeadline'
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

// The total counts up from zero once on arrival (about 0.7 s, ease-out); instant for reduced motion or a zero fare.
function useCountUp(target: number): number {
  const reduced = useReducedMotion()
  const [v, setV] = useState(reduced ? target : 0)
  const done = useRef(false)
  useEffect(() => {
    if (reduced || target <= 0 || done.current) { setV(target); return }
    done.current = true
    const start = Date.now()
    const id = setInterval(() => {
      const k = Math.min(1, (Date.now() - start) / 700)
      setV(target * (1 - Math.pow(1 - k, 3)))
      if (k >= 1) clearInterval(id)
    }, 16)
    return () => clearInterval(id)
  }, [target, reduced])
  return v
}

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
  // A return cab: one more line in the usual ticket saying what it saved (nothing unless the standard fare really is higher).
  const returnSaving = useReturnCabSaving(ride, completed && ride.isReturnCab === true && ride.rideType === 'one_way')

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
  const fareShown = formatMoney(Math.round(useCountUp(fareValue)))
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
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + (canGoBack ? spacing.lg : 96) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Arrival header: a badge, what happened, and the trip in one line. */}
        <Animated.View entering={FadeIn.duration(300)} style={styles.arrive}>
          <Animated.View entering={ZoomIn.springify().damping(12).delay(80)}>
          <LinearGradient colors={completed ? ['#12A0B6', '#0A7788'] : ['#EE5A5E', '#C23B3B']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.badge, completed ? styles.badgeOk : styles.badgeBad]}>
            <Feather name={completed ? 'check' : 'x'} size={26} color="#FFFFFF" />
          </LinearGradient>
          </Animated.View>
          <View style={styles.flex}>
            <Text style={styles.arriveTitle} accessibilityRole="header" numberOfLines={2}>
              {completed ? 'You have arrived' : endedHeadline(ride)}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>{[tripTitle(ride), facts.find((f) => f.key === 'distance')?.value, facts.find((f) => f.key === 'time')?.value].filter(Boolean).join(' · ')}</Text>
            {when ? <Text style={styles.sub} numberOfLines={1}>{when}</Text> : null}
          </View>
        </Animated.View>

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

        {/* The ticket: total, route strip, a perforation, the fare breakdown, total band, trip id. */}
        {showFare || completed ? (
          <Animated.View entering={FadeInDown.duration(420).delay(180)} style={styles.ticket}>
            <LinearGradient colors={['#EEF8F9', '#FFFFFF']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 0.8 }} style={styles.ticketTint} pointerEvents="none" />
            <View style={styles.ticketTop}>
              <View style={styles.flex}>
                <Text style={styles.fareLabel}>{fareCaption ?? 'Total fare'}</Text>
                {showFare ? (
                  <Text style={styles.fare} maxFontSizeMultiplier={1.3} accessibilityLabel={`${fareCaption ?? 'Fare'} ${fareText}`}>{fareShown}</Text>
                ) : null}
              </View>
              {pay && pay.kind === 'paid' ? <Chip label={pay.text} tone="teal" icon="check" /> : null}
              {pay && pay.kind === 'cash_due' ? <Chip label="Cash due" tone="gold" icon="clock" /> : null}
            </View>
            {returnSaving > 0 ? (
              <View style={styles.saveStrip} accessible accessibilityLabel={`You saved about ${returnSaving} rupees with a return cab`}>
                <Feather name="check-circle" size={18} color="#0E7A52" />
                <Text style={styles.saveText}>You saved about {formatMoney(returnSaving)} with a return cab</Text>
              </View>
            ) : null}
            {pay && pay.kind === 'cash_due' ? (
              <View style={styles.dueStrip} accessibilityRole="alert">
                <Feather name="alert-circle" size={18} color={h.goldInk} />
                <Text style={styles.dueText}>{pay.text}</Text>
              </View>
            ) : null}
            <View style={styles.strip}>
              <View style={styles.stripDotA} />
              <Text style={styles.stripText} numberOfLines={1}>{(ride.originAddress ?? 'Pickup').split(',')[0]}</Text>
              <Feather name="arrow-right" size={14} color={h.faint} />
              <View style={styles.stripDotB} />
              <Text style={styles.stripText} numberOfLines={1}>{(drop.value ?? 'Drop').split(',')[0]}</Text>
            </View>
            {drop.note ? <Text style={styles.stripNote}>{drop.note}</Text> : null}

            {completed && invoice.rows.length > 0 ? (
              <>
                <View style={styles.perf} pointerEvents="none">
                  <View style={[styles.notch, { left: -10 }]} />
                  <View style={styles.perfLine} />
                  <View style={[styles.notch, { right: -10 }]} />
                </View>
                <View style={styles.breakdown}>
                  <Text style={styles.sectionTitle}>Fare breakdown</Text>
                  {invoice.rows.map((row, i) => (
                    <View key={row.key} style={[styles.brRow, i > 0 ? styles.brRuled : null]}>
                      <Text style={styles.brLabel}>{row.label}</Text>
                      <Text style={styles.brDetail} numberOfLines={2}>{row.detail ?? ''}</Text>
                      <Text style={styles.brAmount} maxFontSizeMultiplier={1.3}>{row.negative ? `−${formatMoney(row.amount)}` : formatMoney(row.amount)}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>{invoice.discount > 0 ? 'You paid' : 'Total'}</Text>
                  <Text style={styles.totalAmount} maxFontSizeMultiplier={1.3}>{formatMoney(invoice.total)}</Text>
                </View>
              </>
            ) : null}
            <View style={styles.ticketFoot}>
              <Text style={styles.rideId} selectable>Trip ID #{ride.id}</Text>
              {completed ? (
                <Pressable onPress={() => emailSupport('receipt')} accessibilityRole="link" accessibilityLabel="Email a receipt request" hitSlop={8} style={styles.receiptLink}>
                  <Feather name="download" size={15} color={h.tealText} />
                  <Text style={styles.receiptLinkText}>Get receipt</Text>
                </Pressable>
              ) : null}
            </View>
          </Animated.View>
        ) : null}

        {/* Stops only: the ticket's strip already shows pickup -> drop. */}
        {ride.stops.length > 0 ? (
          <View style={styles.section}>
            <StopTimeline stops={ride.stops} />
          </View>
        ) : null}

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
                <View style={styles.plateRow}><PlateBadge plate={driverView.plate} /></View>
              </View>
            </View>
            <RatingSection rideId={ride.id} driverName={driverView.name} existing={ride.userRatingGiven} onRated={handleRated} />
          </View>
        ) : null}

        {/* Help + ride id */}
        <View style={styles.listCard}>
          <Pressable onPress={() => emailSupport('help')} accessibilityRole="link" accessibilityLabel="Get help with this trip, email support" style={styles.listRow}>
            <Text style={styles.listLabel}>Get help with this trip</Text>
            <Feather name="chevron-right" size={20} color={h.faint} />
          </Pressable>
        </View>
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
  content: { paddingHorizontal: 18, gap: 14 },
  map: { height: MAP_HEIGHT, borderRadius: 24, overflow: 'hidden', backgroundColor: h.chip },

  section: { backgroundColor: h.surface, borderRadius: 24, borderWidth: 1, borderColor: h.line07, padding: 18, gap: 14, boxShadow: shadow.sm },
  listCard: { backgroundColor: h.surface, borderRadius: 22, borderWidth: 1, borderColor: h.line07, boxShadow: shadow.sm, overflow: 'hidden' },
  heroTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 24 },
  ruled: hair,
  headRow: { gap: 4 },
  title: { fontFamily: font.b, fontSize: 20, lineHeight: 26, color: h.ivory },
  sub: { fontFamily: font.m, fontSize: 13, color: h.muted },
  fare: { fontFamily: font.xb, fontSize: 42, lineHeight: 48, letterSpacing: -1, color: h.ivory, fontVariant: ['tabular-nums'] },
  arrive: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingTop: 4, paddingLeft: 8 },
  badge: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  badgeOk: { boxShadow: '0 0 0 8px rgba(14,143,163,0.14), 0 10px 22px rgba(14,143,163,0.28)' },
  badgeBad: { boxShadow: '0 0 0 8px rgba(194,59,59,0.12), 0 10px 22px rgba(194,59,59,0.26)' },
  arriveTitle: { fontFamily: font.xb, fontSize: 24, lineHeight: 30, letterSpacing: -0.5, color: h.ivory },
  ticket: { backgroundColor: h.surface, borderRadius: 26, borderWidth: 1, borderColor: h.line07, boxShadow: '0 6px 20px rgba(20,23,26,0.06)', paddingTop: 20 },
  ticketTint: { position: 'absolute', top: 0, left: 0, right: 0, height: 150, borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  ticketTop: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  fareLabel: { fontFamily: font.sb, fontSize: 13, color: h.muted },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginTop: 14, marginBottom: 18, backgroundColor: h.chip, borderRadius: 16, paddingHorizontal: 14, height: 48 },
  stripDotA: { width: 9, height: 9, borderRadius: 5, backgroundColor: h.teal },
  stripDotB: { width: 9, height: 9, borderRadius: 3, backgroundColor: h.ivory },
  stripText: { flex: 1, fontFamily: font.sb, fontSize: 13.5, color: h.ivory },
  stripNote: { fontFamily: font.m, fontSize: 12.5, color: h.muted, marginHorizontal: 22, marginTop: -8, marginBottom: 12 },
  perf: { height: 20, justifyContent: 'center' },
  perfLine: { marginHorizontal: 14, borderTopWidth: 1.5, borderTopColor: h.line10, borderStyle: 'dashed' },
  notch: { position: 'absolute', top: 0, width: 20, height: 20, borderRadius: 10, backgroundColor: h.canvas, borderWidth: 1, borderColor: h.line07 },
  breakdown: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 4 },
  brRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 },
  brRuled: { borderTopWidth: 1, borderTopColor: h.line06 },
  brLabel: { fontFamily: font.sb, fontSize: 14.5, color: h.ivory, flexShrink: 0 },
  brDetail: { flex: 1, textAlign: 'right', fontFamily: font.m, fontSize: 12.5, color: h.muted, fontVariant: ['tabular-nums'] },
  brAmount: { minWidth: 64, textAlign: 'right', fontFamily: font.b, fontSize: 14.5, color: h.ivory, fontVariant: ['tabular-nums'] },
  ticketFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, minHeight: 56 },
  receiptLink: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  receiptLinkText: { fontFamily: font.b, fontSize: 14, color: h.tealText },
  statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, height: 26, borderRadius: 13 },
  pillOk: { backgroundColor: '#DDF5EA' },
  pillBad: { backgroundColor: h.dangerWash },
  pillText: { fontFamily: font.b, fontSize: 12 },
  saveStrip: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#DDF5EA', borderRadius: 16, padding: 14, marginHorizontal: 20, marginTop: 14 },
  saveText: { fontFamily: font.b, fontSize: 14, color: '#0E7A52', flex: 1, fontVariant: ['tabular-nums'] },
  dueStrip: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: h.goldWash, borderRadius: 16, padding: 14, marginHorizontal: 20, marginTop: 14 },
  dueText: { fontFamily: font.b, fontSize: 14, color: h.ivory, flex: 1 },


  sectionTitle: { fontFamily: font.sb, fontSize: 14, color: h.ivory },
  receipt: { gap: 12 },
  receiptRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  receiptLabel: { fontFamily: font.sb, fontSize: 14.5, lineHeight: 21, color: h.ivory },
  receiptDetail: { fontFamily: font.m, fontSize: 12.5, color: h.muted },
  receiptAmount: { fontFamily: font.b, fontSize: 14.5, lineHeight: 21, color: h.ivory, fontVariant: ['tabular-nums'] },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, backgroundColor: h.chip, paddingVertical: 18, paddingHorizontal: 20, marginTop: 6 },
  totalLabel: { fontFamily: font.b, fontSize: 16, color: h.ivory, flex: 1 },
  totalAmount: { fontFamily: font.xb, fontSize: 24, lineHeight: 30, letterSpacing: -0.4, color: h.ivory, fontVariant: ['tabular-nums'] },

  listRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 58, paddingHorizontal: 18 },
  listLabel: { fontFamily: font.sb, fontSize: 15, color: h.ivory, flex: 1 },
  timeline: { paddingHorizontal: 18, paddingBottom: 16, gap: 12 },
  timelineRow: { flexDirection: 'row', gap: 16 },
  timelineTime: { fontFamily: font.b, fontSize: 14.5, lineHeight: 21, width: 72, color: h.ivory, fontVariant: ['tabular-nums'] },

  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  driverName: { fontFamily: font.b, fontSize: 16, color: h.ivory },
  plateRow: { alignItems: 'flex-start', marginTop: 6 },

  rideId: { fontFamily: font.m, fontSize: 13, color: h.faint },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 10, backgroundColor: h.canvas },
})
