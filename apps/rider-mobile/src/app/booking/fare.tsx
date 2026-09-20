import { useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { ErrorState, colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { CategoryCard } from '@/features/booking/components/CategoryCard'
import { SelectRideMap } from '@/features/booking/components/SelectRideMap'
import { useFareEstimates } from '@/features/booking/hooks/useFareEstimates'
import { useBookingDraftStore } from '@/features/booking/store'
import { createBooking, resolveBookingError } from '@/features/booking/api'
import { socket } from '@/services/socket'

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

  const { categories, estimates, loading, error, retry } = useFareEstimates(distanceKm, durationMin, originCityId, rideType, tripHours)

  const [booking, setBooking] = useState(false)
  const [bookError, setBookError] = useState<string | null>(null)
  const bookInFlightRef = useRef(false)
  // Distinct from "0 drivers" -- a fresh poll in flight shouldn't flash a
  // false "no drivers nearby" banner before the first response has landed.
  const [driversPolled, setDriversPolled] = useState(false)
  const [nearbyDriverCount, setNearbyDriverCount] = useState(0)

  const effectiveSelected = selectedCategoryId ?? categories[0]?.id ?? null
  const selectedFare = effectiveSelected != null ? estimates[effectiveSelected]?.breakdown.total : undefined
  const canBook = effectiveSelected != null && selectedFare != null && !booking

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
            onNearbyDriversChange={(polled, count) => { setDriversPolled(polled); setNearbyDriverCount(count) }}
          />
        ) : null}
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, { top: insets.top + spacing.sm }, pressed ? styles.pressedScale : null]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={17} color={colors.ink900} />
        </Pressable>
      </View>

      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.title}>Choose a ride</Text>
          {distanceKm != null && durationMin != null ? (
            <Text style={styles.subtitle}>
              {rideType === 'round_trip'
                ? `${(distanceKm * 2).toFixed(1)} km total · ${Math.round(durationMin)} min · ${tripHours}h`
                : `${distanceKm.toFixed(1)} km · ${Math.round(durationMin)} min`}
            </Text>
          ) : null}
        </View>

        {driversPolled && nearbyDriverCount === 0 ? (
          <View style={styles.noDriversBanner}>
            <Feather name="alert-triangle" size={13} color={colors.warning} />
            <Text style={styles.noDriversText}>No drivers nearby. Try again in a few minutes.</Text>
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
            data={categories}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            style={styles.listFlex}
            renderItem={({ item }) => (
              <CategoryCard
                category={item}
                fareTotal={estimates[item.id]?.breakdown.total ?? null}
                loading={loading && estimates[item.id] === undefined}
                selected={effectiveSelected === item.id}
                onPress={() => setSelectedCategoryId(item.id)}
              />
            )}
          />
        )}

        {/* Fixed footer within the sheet -- Book never drifts with list length. */}
        <View style={[styles.sheetFooter, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          {bookError ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {bookError}
            </Text>
          ) : null}
          <Pressable
            onPress={() => void handleBook()}
            disabled={!canBook}
            style={({ pressed }) => [styles.bookBtn, !canBook ? styles.disabled : null, pressed && canBook ? styles.pressedScale : null]}
            accessibilityRole="button"
            accessibilityLabel="Book this ride"
          >
            {booking ? (
              <ActivityIndicator color={colors.inkInverse} />
            ) : (
              <Text style={styles.bookText}>{selectedFare != null ? `Book · ₹${Math.round(selectedFare)}` : 'Book'}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  mapSection: { width: '100%' },
  backButton: {
    position: 'absolute',
    left: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  pressedScale: { transform: [{ scale: 0.97 }] },
  sheet: {
    flex: 1,
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    marginTop: -radii.xl,
    overflow: 'hidden',
  },
  sheetHeader: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
  noDriversBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    backgroundColor: colors.warningLight,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radii.md,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
  },
  noDriversText: { ...typography.caption, color: colors.warning, fontWeight: '600', flex: 1 },
  title: { ...typography.headline, color: colors.ink900 },
  subtitle: { ...typography.label, color: colors.ink600 },
  listFlex: { flex: 1 },
  list: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  skeletonCard: { height: 72, borderRadius: 16, backgroundColor: colors.surface3, marginBottom: spacing.sm },
  sheetFooter: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderLight },
  error: { ...typography.body, color: colors.error, marginBottom: spacing.xs },
  bookBtn: { backgroundColor: colors.primary, borderRadius: radii.lg, paddingVertical: spacing.sm + 8, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
  disabled: { opacity: 0.5 },
  bookText: { ...typography.body, color: colors.inkInverse, fontWeight: '700' },
})
