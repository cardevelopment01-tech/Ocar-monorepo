import { useEffect, useState } from 'react'
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Button, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { RideMapView } from '@/features/ride-tracking/components/RideMapView'
import { StopTimeline } from '@/features/ride-tracking/components/StopTimeline'
import { fetchRouteLeg } from '@/features/ride-tracking/api'
import type { RideDetailExtra } from '@/features/ride-tracking/types'
import { RatingSection } from './RatingSection'
import {
  buildInvoiceRows, formatMoney, formatTripWhen, paymentState, tripMetrics, tripTitle,
} from './tripSummaryModel'

// Support has no in-app entry on mobile yet; email is the channel the web site already publishes
// (apps/user/lib/company.ts). The ride id in the subject lets support find the trip.
const SUPPORT_EMAIL = 'support@ocarindia.com'
const CASH_POLL_MS = 15_000
const MAP_HEIGHT = 190
const HERO_OVERLAP = 36
// Clears the hero card that overlaps the map's lower edge.
const MAP_FIT_PADDING = { top: 36, right: 48, bottom: HERO_OVERLAP + 36, left: 48 }

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
  const dropLabel = ride.rideType === 'round_trip' ? 'Drop & return' : ride.rideType === 'rental' ? 'Route' : 'Drop'
  const dropValue = ride.rideType === 'rental'
    ? (ride.tripHours ? `${ride.tripHours}h rental · flexible` : 'Hourly rental · flexible')
    : (ride.destinationAddress ?? 'Destination')
  const driverName = ride.driverName ?? 'your driver'
  const initials = driverName.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const vehicle = [ride.vehicleColor, ride.vehicleBrand, ride.vehicleModel ?? ride.vehicleName].filter(Boolean).join(' ')
  const driverMeta = [ride.driverRating ? `★ ${Number(ride.driverRating).toFixed(1)}` : null, vehicle || null, ride.vehicleNumberPlate].filter(Boolean).join(' · ')
  const hasDriver = completed && ride.driverId != null

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={back} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.ink900} />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">Trip summary</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + (canGoBack ? spacing.lg : 96) }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(240)} style={styles.stack}>
          {/* Route preview: the trip at a glance, non-interactive so it never fights the scroll. */}
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

          {/* Hero: what happened, what it cost, whether it is settled. */}
          <View style={[styles.card, styles.hero, hasMap && { marginTop: -HERO_OVERLAP }]}>
            <LinearGradient colors={[colors.primarySubtle, colors.surface]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 0.85 }} style={styles.heroTint} />
            <View style={styles.heroTop}>
              <View style={styles.flex}>
                <Text style={styles.heroTitle} numberOfLines={1}>{tripTitle(ride)}</Text>
                {when ? <Text style={styles.heroWhen}>{when}</Text> : null}
              </View>
              <View style={[styles.pill, completed ? styles.pillOk : styles.pillBad]}>
                <Feather name={completed ? 'check' : 'x'} size={13} color={completed ? colors.success : colors.error} />
                <Text style={[styles.pillText, { color: completed ? colors.success : colors.error }]}>{completed ? 'Completed' : ride.status === 'no_drivers' ? 'No drivers found' : 'Cancelled'}</Text>
              </View>
            </View>
            {showFare ? (
              <View
                style={styles.fareRow}
                accessible
                accessibilityLabel={`${completed ? 'Fare' : 'Cancellation fee'} ${fareText}`}
              >
                <Text style={styles.rupee} maxFontSizeMultiplier={1.3}>{fareText.slice(0, 1)}</Text>
                <Text style={styles.fare} maxFontSizeMultiplier={1.3}>{fareText.slice(1)}</Text>
              </View>
            ) : null}
            {showFare && !completed ? <Text style={styles.heroWhen}>Cancellation fee</Text> : null}
            {pay ? (
              pay.kind === 'cash_due' ? (
                <View style={styles.dueStrip} accessibilityRole="alert">
                  <Feather name="alert-circle" size={18} color={colors.warning} />
                  <Text style={styles.dueText}>{pay.text}</Text>
                </View>
              ) : (
                <View style={styles.paidRow}>
                  <Feather name="check-circle" size={16} color={colors.success} />
                  <Text style={styles.paidText}>{pay.text}</Text>
                </View>
              )
            ) : null}
          </View>

          {/* Route */}
          <View style={styles.card}>
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
            {ride.stops.length > 0 ? (
              <>
                <View style={styles.divider} />
                <StopTimeline stops={ride.stops} />
              </>
            ) : null}
            {metrics && completed ? (
              <View style={styles.metricsBar}>
                <Feather name="clock" size={15} color={colors.primary} />
                <Text style={styles.metrics}>{metrics}</Text>
              </View>
            ) : null}
          </View>

          {/* Driver + rating */}
          {hasDriver ? (
            <View style={styles.card}>
              <View style={styles.driverRow}>
                {ride.driverPhoto ? (
                  <Image source={{ uri: ride.driverPhoto }} style={styles.avatar} accessibilityIgnoresInvertColors />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarInitials}>{initials}</Text></View>
                )}
                <View style={styles.flex}>
                  <Text style={styles.driverName} numberOfLines={1}>{driverName}</Text>
                  {driverMeta ? <Text style={styles.driverMeta} numberOfLines={1}>{driverMeta}</Text> : null}
                </View>
              </View>
              <View style={styles.divider} />
              <RatingSection rideId={ride.id} driverName={driverName} existing={ride.userRatingGiven} onRated={onRefresh} />
            </View>
          ) : null}

          {/* Fare details */}
          {completed && invoice.rows.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Fare details</Text>
              {invoice.rows.map((row) => (
                <View key={row.key} style={styles.invoiceRow}>
                  <View style={styles.rowIcon}><Feather name={row.icon} size={15} color={colors.primary} /></View>
                  <Text style={styles.invoiceLabel}>{row.label}</Text>
                  <Text style={styles.invoiceAmount} maxFontSizeMultiplier={1.3}>{formatMoney(row.amount)}</Text>
                </View>
              ))}
              <View style={styles.totalBand}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalAmount} maxFontSizeMultiplier={1.3}>{formatMoney(invoice.total)}</Text>
              </View>
            </View>
          ) : null}

          {/* Help + ride id */}
          <Pressable
            onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Ride #${ride.id} - help`)}`)}
            accessibilityRole="link"
            accessibilityLabel="Need help with this ride? Email support"
            style={[styles.card, styles.helpRow]}
          >
            <View style={styles.helpIcon}><Feather name="headphones" size={20} color={colors.primary} /></View>
            <View style={styles.flex}>
              <Text style={styles.helpTitle}>Need help?</Text>
              <Text style={styles.helpSub}>We&apos;re a tap away</Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.ink400} />
          </Pressable>
          <Text style={styles.rideId} selectable>Ride ID #{ride.id}</Text>
        </Animated.View>
      </ScrollView>

      {!canGoBack ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Button label="Back to home" onPress={goHome} />
        </View>
      ) : null}
    </View>
  )
}

const cardShadow = { shadowColor: '#0E8FA3', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 4 }, elevation: 3 } as const

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typography.headline, color: colors.ink900 },
  content: { paddingHorizontal: spacing.md },
  stack: { gap: spacing.sm + 4 },
  card: { backgroundColor: colors.surface, borderRadius: radii['2xl'], padding: spacing.md + 4, gap: spacing.sm + 4, ...cardShadow },
  divider: { height: 1, backgroundColor: colors.border },

  map: { height: MAP_HEIGHT, borderRadius: radii['2xl'], overflow: 'hidden', backgroundColor: colors.surface3 },

  hero: { gap: spacing.sm },
  // Rounded by itself instead of overflow:hidden on the card, which would clip the iOS shadow.
  heroTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radii['2xl'] },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  heroTitle: { ...typography.title, color: colors.ink900 },
  heroWhen: { ...typography.label, color: colors.ink600 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.full },
  pillOk: { backgroundColor: colors.successLight },
  pillBad: { backgroundColor: colors.errorLight },
  pillText: { fontFamily: fonts.semibold, fontSize: 12 },
  fareRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.xs },
  rupee: { fontFamily: fonts.semibold, fontSize: 26, lineHeight: 34, color: colors.ink600, marginTop: 6, marginRight: 2 },
  fare: { fontFamily: fonts.bold, fontSize: 48, lineHeight: 56, letterSpacing: -1.2, color: colors.ink900, fontVariant: ['tabular-nums'] },
  dueStrip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.warningLight, borderRadius: radii.lg, padding: spacing.sm + 4, marginTop: spacing.xs },
  dueText: { ...typography.label, fontSize: 14, fontFamily: fonts.bold, color: colors.ink900, flex: 1 },
  paidRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  paidText: { ...typography.label, fontSize: 14, fontFamily: fonts.semibold, color: colors.success },

  routeRow: { flexDirection: 'row', gap: spacing.sm + 4 },
  dots: { alignItems: 'center', paddingVertical: 5 },
  dot: { width: 10, height: 10 },
  dotPickup: { borderRadius: 5, backgroundColor: colors.primary },
  dotDrop: { borderRadius: 2, backgroundColor: colors.ink900 },
  line: { width: 1, flex: 1, minHeight: 24, backgroundColor: colors.border },
  routeText: { flex: 1, minWidth: 0, gap: spacing.md },
  routeLabel: { ...typography.caption, color: colors.ink400, fontFamily: fonts.semibold },
  routeValue: { ...typography.body, lineHeight: 22, color: colors.ink900, fontFamily: fonts.semibold },
  metricsBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primarySubtle, borderRadius: radii.lg, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.sm + 4 },
  metrics: { ...typography.label, fontSize: 14, fontFamily: fonts.semibold, color: colors.ink900 },

  driverRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  avatar: { width: 44, height: 44, borderRadius: 14 },
  avatarFallback: { backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontFamily: fonts.bold, fontSize: 15, color: colors.primary },
  driverName: { ...typography.title, color: colors.ink900 },
  driverMeta: { ...typography.label, color: colors.ink600 },

  sectionTitle: { ...typography.title, color: colors.ink900 },
  invoiceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  rowIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  invoiceLabel: { ...typography.body, lineHeight: 22, color: colors.ink600, flex: 1 },
  invoiceAmount: { ...typography.body, lineHeight: 22, color: colors.ink900, fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] },
  totalBand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, backgroundColor: colors.primarySubtle, borderRadius: radii.lg, paddingVertical: spacing.sm + 6, paddingHorizontal: spacing.md, marginTop: spacing.xs },
  totalLabel: { ...typography.title, color: colors.ink900, flex: 1 },
  totalAmount: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, color: colors.ink900, fontVariant: ['tabular-nums'] },

  helpRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, minHeight: 64 },
  helpIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  helpTitle: { ...typography.title, fontSize: 16, color: colors.ink900 },
  helpSub: { ...typography.label, color: colors.ink600 },
  rideId: { ...typography.caption, color: colors.ink400, textAlign: 'center', paddingVertical: spacing.xs },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: colors.bg },
})
