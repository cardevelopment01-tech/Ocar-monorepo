import { useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, ErrorState, colors, radii, shadows, spacing, typography } from '@ocar/mobile-shared'
import { CategoryCard, type CategoryEta } from '@/features/booking/components/CategoryCard'
import { SelectRideMap } from '@/features/booking/components/SelectRideMap'
import { useFareEstimates } from '@/features/booking/hooks/useFareEstimates'
import { useBookingDraftStore } from '@/features/booking/store'
import { resolveSelectedCategory } from '@/features/booking/resolveSelectedCategory'
import { createBooking, resolveBookingError } from '@/features/booking/api'
import { socket } from '@/services/socket'

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

// Map fills the top of the screen (fixed), the ride list + Book button live in
// a sheet anchored below it -- matches the "map positioned properly, ride
// select below rather than in the middle" redesign: previously the map was a
// small fixed box sandwiched between the header and a scrolling list, so the
// Book button drifted up and down with however many categories loaded.
const MAP_HEIGHT_RATIO = 0.4

export default function BookingFareScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const pickup = useBookingDraftStore((s) => s.pickup)
  const drop = useBookingDraftStore((s) => s.drop)
  const distanceKm = useBookingDraftStore((s) => s.distanceKm)
  const durationMin = useBookingDraftStore((s) => s.durationMin)
  const originCityId = useBookingDraftStore((s) => s.originCityId)
  const routePoints = useBookingDraftStore((s) => s.routePoints)
  const selectedCategoryId = useBookingDraftStore((s) => s.selectedCategoryId)
  const setSelectedCategoryId = useBookingDraftStore((s) => s.setSelectedCategoryId)
  const rideType = useBookingDraftStore((s) => s.rideType)
  const tripHours = useBookingDraftStore((s) => s.tripHours)
  const stops = useBookingDraftStore((s) => s.stops)
  const scheduledFor = useBookingDraftStore((s) => s.scheduledFor)
  const riderName = useBookingDraftStore((s) => s.riderName)
  const riderPhone = useBookingDraftStore((s) => s.riderPhone)
  const resetDraft = useBookingDraftStore((s) => s.reset)

  const {
    categories, estimates, loading, error, retry,
    returnCabCategories, returnCabEstimates,
  } = useFareEstimates(distanceKm, durationMin, originCityId, rideType, tripHours, pickup, drop, scheduledFor)

  const [isReturnCab, setIsReturnCab] = useState(false)
  const [booking, setBooking] = useState(false)
  const [bookError, setBookError] = useState<string | null>(null)
  const bookInFlightRef = useRef(false)
  // Distinct from "0 drivers" -- a fresh poll in flight shouldn't flash a
  // false "no drivers nearby" banner before the first response has landed.
  const [driversPolled, setDriversPolled] = useState(false)
  const [nearbyDrivers, setNearbyDrivers] = useState<Array<{ driverId: string; lat: number; lng: number; categoryId: number }>>([])
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [paymentNote, setPaymentNote] = useState<string | null>(null)

  // Hide any category whose estimate fetch failed (e.g. no rate card for this
  // ride_type -- auto_rickshaw only has `rental`) once loading has settled;
  // keep showing all cards during the initial load so skeletons still render.
  // Matches web's identical fix (apps/user/app/(main)/select-ride/page.tsx) --
  // without this, a rental-only category shows up here too and 422s on booking.
  const visibleCategories = categories.filter((cat) => loading || estimates[cat.id] !== undefined)

  // Per-category nearest-driver ETA, mirrors web's driverEta memo
  // (apps/user/app/(main)/select-ride/page.tsx) -- same nearby-drivers poll
  // the map already runs, just grouped by category instead of drawn as pins.
  const driverEta = useMemo(() => {
    const result: Record<number, CategoryEta> = {}
    if (!pickup) return result
    for (const cat of visibleCategories) {
      const inCat = nearbyDrivers.filter((d) => d.categoryId === cat.id)
      if (inCat.length === 0) { result[cat.id] = { count: 0, etaMin: -1 }; continue }
      const nearest = Math.min(...inCat.map((d) => haversineKm(pickup.lat, pickup.lng, d.lat, d.lng)))
      result[cat.id] = { count: inCat.length, etaMin: Math.max(1, Math.round(nearest / 0.5)) }
    }
    return result
  }, [nearbyDrivers, visibleCategories, pickup])

  const effectiveSelected = resolveSelectedCategory(visibleCategories.map((c) => c.id), selectedCategoryId)
  const selectedFare = effectiveSelected != null
    ? (isReturnCab ? returnCabEstimates[effectiveSelected] : estimates[effectiveSelected])?.breakdown.total
    : undefined
  const allUnavailable = driversPolled && visibleCategories.length > 0 && visibleCategories.every((c) => (driverEta[c.id]?.count ?? 0) === 0)
  const selectedNoCars = driversPolled && effectiveSelected != null && (driverEta[effectiveSelected]?.count ?? 0) === 0
  const canBook = effectiveSelected != null && selectedFare != null && !booking && !selectedNoCars

  // Available categories first, unavailable ones pushed to the bottom rather
  // than left interleaved -- categories list order otherwise comes straight
  // from vehicle_categories (display order, not availability).
  const sortedCategories = driversPolled
    ? [...visibleCategories].sort((a, b) => {
        const aNo = (driverEta[a.id]?.count ?? 0) === 0 ? 1 : 0
        const bNo = (driverEta[b.id]?.count ?? 0) === 0 ? 1 : 0
        return aNo - bNo
      })
    : visibleCategories

  async function handleBook() {
    if (!pickup || !drop || effectiveSelected == null || bookInFlightRef.current) return
    bookInFlightRef.current = true
    setBooking(true)
    setBookError(null)
    try {
      const input: Parameters<typeof createBooking>[0] = {
        categoryId: effectiveSelected,
        rideType,
        originLat: pickup.lat,
        originLng: pickup.lng,
        destinationLat: drop.lat,
        destinationLng: drop.lng,
        distanceKm: distanceKm ?? 0,
        durationMin: durationMin ?? 0,
      }
      if (pickup.address) input.originAddress = pickup.address
      if (drop.address) input.destinationAddress = drop.address
      if (originCityId !== null) input.originCityId = originCityId
      if (rideType === 'round_trip' && tripHours !== null) input.tripHours = tripHours
      if (stops.length > 0) input.stops = stops
      if (scheduledFor) input.scheduledFor = scheduledFor
      if (riderName && riderPhone) { input.riderName = riderName; input.riderPhone = riderPhone }
      if (isReturnCab) input.isReturnCab = true

      const result = await createBooking(input)

      // Join the ride room synchronously, right after the response resolves and
      // before any navigation/setState -- closes the race where the backend
      // could emit an early ride:status_update (e.g. instant auto-assignment)
      // before a listener exists. /ride/[id] (features/ride-tracking's
      // useRideTracking, owned by a different engineer this phase, already
      // implements the "searching for driver" state, the durable
      // reconnect-and-rejoin subscription via its own useRoomJoin() call, and
      // GET /rides/:id status polling -- this screen's job ends at the booking
      // call plus this one pre-navigation join, not a second parallel
      // "searching" screen.
      socket.emit('join:ride', result.rideId)

      const rideId = result.rideId
      resetDraft()
      router.replace(`/ride/${rideId}`)
    } catch (err) {
      setBookError(resolveBookingError(err))
    } finally {
      setBooking(false)
      bookInFlightRef.current = false
    }
  }

  if (error && categories.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
        <ErrorState message={error} onRetry={retry} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={[styles.mapSection, { height: windowHeight * MAP_HEIGHT_RATIO }]}>
        {pickup && drop ? (
          <SelectRideMap
            pickup={[pickup.lat, pickup.lng]}
            drop={[drop.lat, drop.lng]}
            routePoints={routePoints}
            fill
            refreshSignal={refreshSignal}
            onNearbyDriversChange={(polled) => setDriversPolled(polled)}
            onDrivers={setNearbyDrivers}
          />
        ) : null}
        <View style={[styles.headerRow, { top: insets.top + spacing.sm }]}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed ? styles.pressedScale : null]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Feather name="arrow-left" size={17} color={colors.ink900} />
          </Pressable>
          {pickup && drop ? (
            <View style={styles.breadcrumb}>
              <Pressable onPress={() => router.back()} style={styles.breadcrumbHalf}>
                <Text style={styles.breadcrumbOrigin} numberOfLines={1}>{pickup.address}</Text>
              </Pressable>
              <Feather name="chevron-right" size={12} color={colors.ink400} />
              <Pressable onPress={() => router.back()} style={styles.breadcrumbHalf}>
                <Text style={styles.breadcrumbDest} numberOfLines={1}>{drop.address}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.sheetShadowWrap}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <Text style={styles.title}>Choose a ride</Text>
              {distanceKm != null && durationMin != null ? (
                <Text style={styles.subtitle}>
                  {rideType === 'round_trip'
                    ? `${(distanceKm * 2).toFixed(1)} km total · ${Math.round(durationMin)} min · ${tripHours}h`
                    : `${distanceKm.toFixed(1)} km · ${Math.round(durationMin)} min`}
                </Text>
              ) : null}
            </View>
          </View>

          {allUnavailable ? (
            <View style={styles.noDriversBanner}>
              <Feather name="clock" size={13} color={colors.warning} />
              <Text style={styles.noDriversText}>No drivers nearby. Try again in a few minutes.</Text>
              <Pressable onPress={() => setRefreshSignal((n) => n + 1)} hitSlop={6}>
                <Text style={styles.noDriversAction}>Retry now</Text>
              </Pressable>
            </View>
          ) : null}

          {loading && categories.length === 0 ? (
            <View style={styles.list}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={styles.skeletonCard} />
              ))}
            </View>
          ) : (
            <FlatList
              data={sortedCategories}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={styles.list}
              style={styles.listFlex}
              ItemSeparatorComponent={() => <View style={styles.divider} />}
              ListHeaderComponent={
                rideType === 'one_way' && !scheduledFor && returnCabCategories.size > 0 ? (
                  <View style={styles.returnCabSection}>
                    <Text style={styles.returnCabLabel}>Return Cab Available</Text>
                    {visibleCategories
                      .filter((cat) => returnCabCategories.has(cat.id))
                      .map((cat) => {
                        const rcFare = returnCabEstimates[cat.id]?.breakdown.total
                        const stdFare = estimates[cat.id]?.breakdown.total
                        const isSel = isReturnCab && effectiveSelected === cat.id
                        return (
                          <CategoryCard
                            key={`rc-${cat.id}`}
                            category={cat}
                            fareTotal={rcFare ?? null}
                            loading={loading && rcFare == null}
                            selected={isSel}
                            onPress={() => { setSelectedCategoryId(cat.id); setIsReturnCab(true) }}
                            variant="returnCab"
                            savingsText={
                              rcFare != null && stdFare != null && Math.round(stdFare) > Math.round(rcFare)
                                ? `Save ₹${Math.round(stdFare - rcFare)} vs standard`
                                : 'Discounted return rate'
                            }
                          />
                        )
                      })}
                    <View style={styles.returnCabDivider} />
                  </View>
                ) : null
              }
              renderItem={({ item }) => {
                const noCars = driversPolled && (driverEta[item.id]?.count ?? 0) === 0
                return (
                  <CategoryCard
                    category={item}
                    fareTotal={estimates[item.id]?.breakdown.total ?? null}
                    loading={loading && estimates[item.id] === undefined}
                    selected={!isReturnCab && effectiveSelected === item.id}
                    onPress={() => { setSelectedCategoryId(item.id); setIsReturnCab(false) }}
                    eta={driverEta[item.id] ?? null}
                    disabled={noCars}
                  />
                )
              }}
            />
          )}

          {/* Fixed footer within the sheet -- Book never drifts with list length. */}
          <View style={[styles.sheetFooter, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <View style={styles.paymentRow}>
              <View style={styles.paymentLeft}>
                <View style={styles.paymentIconWrap}>
                  <Feather name="credit-card" size={14} color={colors.ink600} />
                </View>
                <Text style={styles.paymentLabel}>Cash</Text>
              </View>
              <Pressable
                onPress={() => { setPaymentNote('Cash only for now'); setTimeout(() => setPaymentNote(null), 2000) }}
                hitSlop={6}
              >
                <Text style={styles.paymentChange}>Change</Text>
              </Pressable>
            </View>
            {paymentNote ? <Text style={styles.paymentNote}>{paymentNote}</Text> : null}
            {bookError ? (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {bookError}
              </Text>
            ) : null}
            <Button
              label={
                allUnavailable
                  ? 'No drivers available'
                  : selectedFare != null
                  ? `Book · ₹${Math.round(selectedFare)}`
                  : 'Book'
              }
              onPress={() => void handleBook()}
              disabled={!canBook}
              loading={booking}
              accessibilityLabel="Book this ride"
            />
          </View>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  mapSection: { width: '100%' },
  headerRow: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    elevation: 3,
    shadowColor: colors.primary,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  breadcrumb: {
    flex: 1,
    height: 40,
    backgroundColor: colors.surface,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    gap: 4,
    elevation: 3,
    shadowColor: colors.primary,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  breadcrumbHalf: { flex: 1, minWidth: 0 },
  breadcrumbOrigin: { ...typography.caption, fontWeight: '500', color: colors.ink600 },
  breadcrumbDest: { ...typography.caption, fontWeight: '700', color: colors.ink900 },
  pressedScale: { transform: [{ scale: 0.97 }] },
  sheetShadowWrap: {
    flex: 1,
    marginTop: -radii.xl,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    ...shadows.card,
    shadowOpacity: 0.12,
  },
  sheet: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    overflow: 'hidden',
  },
  sheetHeader: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.sm },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  noDriversBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    backgroundColor: colors.warningLight,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
    borderRadius: radii.md,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
  },
  noDriversText: { ...typography.caption, color: colors.warning, fontWeight: '600', flex: 1 },
  noDriversAction: { ...typography.caption, color: colors.warning, fontWeight: '700', textDecorationLine: 'underline' },
  title: { ...typography.headline, color: colors.ink900 },
  subtitle: { ...typography.caption, fontWeight: '600', color: colors.ink400 },
  listFlex: { flex: 1 },
  list: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  returnCabSection: { marginBottom: spacing.xs },
  returnCabLabel: { ...typography.caption, fontWeight: '700', color: colors.success, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: spacing.xs },
  returnCabDivider: { height: 1, backgroundColor: colors.borderLight, marginTop: spacing.xs, marginBottom: spacing.sm },
  divider: { height: 1, backgroundColor: colors.borderLight, marginVertical: 2 },
  skeletonCard: { height: 72, borderRadius: 16, backgroundColor: colors.surface3, marginBottom: spacing.sm },
  sheetFooter: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderLight },
  paymentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  paymentLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  paymentIconWrap: { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  paymentLabel: { ...typography.label, fontWeight: '600', color: colors.ink600 },
  paymentChange: { ...typography.caption, fontWeight: '700', color: colors.primaryDark },
  paymentNote: { ...typography.caption, color: colors.ink400, textAlign: 'center', marginBottom: spacing.xs },
  error: { ...typography.body, color: colors.error, marginBottom: spacing.xs },
})
