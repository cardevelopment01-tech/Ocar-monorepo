import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Skeleton, VehicleIcon, colors, radii, spacing, typography, fonts } from '@ocar/mobile-shared'
import type { RentalPackage, VehicleCategory } from '@ocar/mobile-shared'
import { createBooking, fetchRentalPackages, fetchRoute, fetchVehicleCategories, fetchFareEstimate, resolveBookingError } from '@/features/booking/api'
import { recommendPackage } from '@/features/booking/recommendPackage'
import { useBookingDraftStore } from '@/features/booking/store'
import { socket } from '@/services/socket'
import { RiderSheet } from '@/features/booking/components/RiderSheet'
import { ScheduleSheet, formatPickupTime } from '@/features/booking/components/ScheduleSheet'
import { StopsList } from '@/features/booking/components/StopsList'
import { sectionLabel } from '@/theme/homeTokens'

const MAX_STOPS = 3

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} hr${h > 1 ? 's' : ''}` : `${h}h ${m}m`
}

// Matches web's /rental ("City Rides", apps/user/app/(main)/rental/page.tsx) --
// a self-contained booking screen (category + package + fare + book), unlike
// round-trip which hands off to /select-ride for the category step.
export default function RentalScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const pickup = useBookingDraftStore((s) => s.pickup)
  const drop = useBookingDraftStore((s) => s.drop)
  const originCityId = useBookingDraftStore((s) => s.originCityId)
  const stops = useBookingDraftStore((s) => s.stops)
  const removeStop = useBookingDraftStore((s) => s.removeStop)
  const swapStop = useBookingDraftStore((s) => s.swapStop)
  const scheduledFor = useBookingDraftStore((s) => s.scheduledFor)
  const setScheduledFor = useBookingDraftStore((s) => s.setScheduledFor)
  const riderName = useBookingDraftStore((s) => s.riderName)
  const riderPhone = useBookingDraftStore((s) => s.riderPhone)
  const setRider = useBookingDraftStore((s) => s.setRider)
  const clearRider = useBookingDraftStore((s) => s.clearRider)
  const resetDraft = useBookingDraftStore((s) => s.reset)
  const bookingForOther = riderName !== '' && riderPhone !== ''
  const [riderSheetOpen, setRiderSheetOpen] = useState(false)
  const [scheduleSheetOpen, setScheduleSheetOpen] = useState(false)

  const [categories, setCategories] = useState<VehicleCategory[]>([])
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null)
  const [packages, setPackages] = useState<RentalPackage[]>([])
  const [pkgsLoading, setPkgsLoading] = useState(true)
  const [selectedPkgId, setSelectedPkgId] = useState<number | null>(null)
  const [estimate, setEstimate] = useState<Awaited<ReturnType<typeof fetchFareEstimate>> | null>(null)
  const [estLoading, setEstLoading] = useState(false)
  const [booking, setBooking] = useState(false)
  const [bookError, setBookError] = useState<string | null>(null)
  const bookInFlightRef = useRef(false)

  useEffect(() => {
    fetchVehicleCategories()
      .then((cats) => {
        setCategories(cats)
        if (cats[0]) setSelectedCatId(cats[0].id)
      })
      .catch(() => {})
  }, [])

  // Route pickup → stops → drop. Not traffic-aware: package tiers are coarse, so live
  // traffic wouldn't change the pick but would double routing cost per lookup.
  const [trip, setTrip] = useState<{ km: number; min: number } | null>(null)
  // False while the route is in flight, so we don't preselect a package and then
  // immediately flip to the recommended one (fare flicker + wasted estimate call).
  const [tripReady, setTripReady] = useState(false)
  useEffect(() => {
    if (!pickup || !drop) { setTrip(null); setTripReady(true); return }
    let cancelled = false
    setTripReady(false)
    const pts = [pickup, ...stops, drop]
    Promise.all(pts.slice(0, -1).map((p, i) => fetchRoute(p.lat, p.lng, pts[i + 1]!.lat, pts[i + 1]!.lng)))
      .then((legs) => {
        if (cancelled) return
        setTrip({
          km: Math.round(legs.reduce((s, l) => s + l.distanceKm, 0) * 10) / 10,
          min: Math.round(legs.reduce((s, l) => s + l.durationMin, 0)),
        })
        setTripReady(true)
      })
      .catch(() => { if (!cancelled) { setTrip(null); setTripReady(true) } })
    return () => { cancelled = true }
  }, [pickup, drop, stops])

  // Selection follows the recommendation until the rider picks a package themselves.
  const [userPickedPkg, setUserPickedPkg] = useState(false)
  const loadPackages = useCallback(async (catId: number) => {
    setPkgsLoading(true)
    setPackages([])
    setSelectedPkgId(null)
    setUserPickedPkg(false)
    setEstimate(null)
    try {
      const pkgs = await fetchRentalPackages(catId, originCityId)
      setPackages(pkgs)
    } catch {
      setPackages([])
    } finally {
      setPkgsLoading(false)
    }
  }, [originCityId])

  useEffect(() => {
    if (selectedCatId !== null) void loadPackages(selectedCatId)
  }, [selectedCatId, loadPackages])

  useEffect(() => {
    if (selectedPkgId === null || selectedCatId === null) return
    let cancelled = false
    setEstLoading(true)
    setEstimate(null)
    const input: Parameters<typeof fetchFareEstimate>[0] = {
      categoryId: selectedCatId,
      rideType: 'rental',
      distanceKm: 0,
      durationMin: 0,
      rentalPackageId: selectedPkgId,
    }
    if (originCityId !== null) input.cityId = originCityId
    fetchFareEstimate(input)
      .then((est) => { if (!cancelled) setEstimate(est) })
      .catch(() => { if (!cancelled) setEstimate(null) })
      .finally(() => { if (!cancelled) setEstLoading(false) })
    return () => { cancelled = true }
  }, [selectedPkgId, selectedCatId, originCityId])

  const recommendation = useMemo(
    () => (trip ? recommendPackage(packages, trip.km, trip.min) : null),
    [packages, trip],
  )
  useEffect(() => {
    if (userPickedPkg || !tripReady || packages.length === 0) return
    setSelectedPkgId(recommendation?.packageId ?? packages[0]!.id)
  }, [packages, recommendation, userPickedPkg, tripReady])

  const selectedCat = categories.find((c) => c.id === selectedCatId)
  const selectedPkg = packages.find((p) => p.id === selectedPkgId) ?? null
  const canBook = selectedCatId !== null && selectedPkgId !== null && estimate !== null && !estLoading && !!drop && !booking

  async function handleBook() {
    if (!pickup || !drop || selectedCatId === null || selectedPkgId === null || bookInFlightRef.current) return
    bookInFlightRef.current = true
    setBooking(true)
    setBookError(null)
    try {
      const input: Parameters<typeof createBooking>[0] = {
        categoryId: selectedCatId,
        rideType: 'rental',
        originLat: pickup.lat,
        originLng: pickup.lng,
        destinationLat: drop.lat,
        destinationLng: drop.lng,
        distanceKm: 0,
        durationMin: 0,
        rentalPackageId: selectedPkgId,
      }
      if (pickup.address) input.originAddress = pickup.address
      if (drop.address) input.destinationAddress = drop.address
      if (originCityId !== null) input.originCityId = originCityId
      if (stops.length > 0) input.stops = stops
      if (scheduledFor) input.scheduledFor = scheduledFor
      if (riderName && riderPhone) { input.riderName = riderName; input.riderPhone = riderPhone }

      const result = await createBooking(input)
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

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed ? styles.pressedScale : null]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={17} color={colors.ink900} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>City Rides</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{pickup?.address ?? 'Pickup location'}</Text>
        </View>
        <Pressable
          onPress={() => setRiderSheetOpen(true)}
          style={styles.riderPill}
          accessibilityRole="button"
          accessibilityLabel="Who's travelling"
        >
          <Feather name="user" size={11} color={colors.primaryDark} />
          <Text style={styles.riderPillText} numberOfLines={1}>{bookingForOther ? riderName : 'For me'}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <View style={styles.routeCard}>
          <Feather name="navigation" size={13} color={colors.primary} />
          <Text style={styles.routeText} numberOfLines={1}>{drop?.address ?? 'Destination'}</Text>
        </View>

        <Pressable onPress={() => setScheduleSheetOpen(true)} style={styles.scheduleChip} accessibilityRole="button">
          <Feather name="clock" size={12} color={colors.primaryDark} />
          <Text style={styles.scheduleChipText}>{scheduledFor ? formatPickupTime(new Date(scheduledFor)) : 'Now'}</Text>
          {scheduledFor ? (
            <Pressable onPress={() => setScheduledFor(null)} hitSlop={8} accessibilityLabel="Reset to ride now">
              <Feather name="x" size={12} color={colors.primaryDark} />
            </Pressable>
          ) : null}
        </Pressable>

        <StopsList
          stops={stops}
          maxStops={MAX_STOPS}
          onAdd={() => router.push('/booking/add-stop')}
          onRemove={removeStop}
          onSwap={swapStop}
        />

        <Text style={styles.sectionLabel}>VEHICLE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catRow}>
          {categories.map((cat) => {
            const active = cat.id === selectedCatId
            return (
              <Pressable
                key={cat.id}
                onPress={() => setSelectedCatId(cat.id)}
                style={[styles.catChip, active ? styles.catChipActive : null]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <VehicleIcon slug={cat.slug} size={28} />
                <Text style={[styles.catName, active ? styles.catNameActive : null]}>{cat.displayName}</Text>
                <View style={styles.catSeatsRow}>
                  <Feather name="users" size={9} color={active ? colors.primary : colors.ink400} />
                  <Text style={[styles.catSeats, active ? styles.catNameActive : null]}>{cat.maxPassengers}</Text>
                </View>
              </Pressable>
            )
          })}
        </ScrollView>

        <View style={styles.pkgHeader}>
          <Text style={styles.sectionLabel}>PACKAGE</Text>
          {trip ? <Text style={styles.routeSummary}>{`Your route · ${trip.km} km · ~${formatDuration(trip.min)}`}</Text> : null}
        </View>
        {pkgsLoading ? (
          <View style={styles.pkgList}>
            <Skeleton width="100%" height={72} borderRadius={16} />
            <Skeleton width="100%" height={72} borderRadius={16} />
          </View>
        ) : packages.length === 0 ? (
          <View style={styles.emptyPkg}>
            <Text style={styles.emptyPkgText}>No packages for this vehicle type</Text>
          </View>
        ) : (
          <View style={styles.pkgList}>
            {packages.map((pkg) => {
              const active = pkg.id === selectedPkgId
              const isRec = recommendation?.packageId === pkg.id
              return (
                <Pressable
                  key={pkg.id}
                  onPress={() => { setUserPickedPkg(true); setSelectedPkgId(pkg.id) }}
                  style={[styles.pkgRow, isRec ? styles.pkgRowRec : null, active ? styles.pkgRowActive : null]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityHint={isRec ? 'Recommended for your trip' : undefined}
                >
                  {isRec ? (
                    <View style={styles.recTag}>
                      <Feather name="star" size={9} color={colors.inkInverse} />
                      <Text style={styles.recTagText}>Recommended for your trip</Text>
                    </View>
                  ) : null}
                  <View style={[styles.pkgIconWrap, active ? styles.pkgIconWrapActive : null]}>
                    <Feather name="clock" size={16} color={active ? colors.primary : colors.ink400} />
                  </View>
                  <View style={styles.pkgInfo}>
                    <Text style={[styles.pkgTitle, active ? styles.pkgTitleActive : null]}>
                      {`${formatDuration(pkg.durationMinutes)} · ${pkg.kmLimit} km`}
                    </Text>
                    <Text style={styles.pkgMeta}>{`Extra ₹${pkg.extraPerKm}/km · ₹${pkg.extraPerMin}/min beyond limit`}</Text>
                  </View>
                  <Text style={[styles.pkgFare, active ? styles.pkgTitleActive : null]}>{`₹${Math.round(pkg.packageFare)}`}</Text>
                </Pressable>
              )
            })}
            {recommendation?.exceeds && trip && (recommendation.overKm > 0 || recommendation.overMin > 0) ? (
              <View style={styles.warnCard}>
                <Feather name="info" size={14} color={colors.warning} />
                <Text style={styles.warnText}>
                  {`Your route (~${trip.km} km, ${formatDuration(trip.min)}) is longer than our biggest package.${
                    recommendation.overKm > 0 ? ` About ${recommendation.overKm} km over` : ''
                  }${recommendation.overKm > 0 && recommendation.overMin > 0 ? ' and' : ''}${
                    recommendation.overMin > 0 ? ` ${formatDuration(recommendation.overMin)} over` : ''
                  } will be charged as extra.`}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {selectedPkg ? (
          <View style={styles.fareCard}>
            <Text style={styles.fareCardTitle}>
              {`${selectedCat?.displayName ?? ''} · ${formatDuration(selectedPkg.durationMinutes)} / ${selectedPkg.kmLimit} km`}
            </Text>
            <Text style={styles.fareCardSub}>Overage charged at end of trip</Text>
            <View style={styles.fareDivider} />
            <View style={styles.fareTotalRow}>
              <Text style={styles.fareTotalLabel}>Total</Text>
              {estLoading ? (
                <Skeleton width={64} height={20} />
              ) : estimate != null ? (
                <Text style={styles.fareTotalValue}>{`₹${Math.round(estimate.breakdown.total)}`}</Text>
              ) : (
                <Text style={styles.fareTotalUnavailable}>-</Text>
              )}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        {bookError ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">{bookError}</Text>
        ) : null}
        <Pressable
          onPress={() => void handleBook()}
          disabled={!canBook}
          style={({ pressed }) => [styles.bookBtn, !canBook ? styles.disabled : null, pressed && canBook ? styles.pressedScale : null]}
          accessibilityRole="button"
        >
          {booking ? (
            <ActivityIndicator color={colors.inkInverse} />
          ) : (
            <Text style={styles.bookText}>
              {!drop
                ? 'Add a drop-off to continue'
                : !selectedPkg
                ? 'Select a package'
                : estimate != null
                ? `Book · ₹${Math.round(estimate.breakdown.total)}`
                : 'Book'}
            </Text>
          )}
        </Pressable>
      </View>

      <RiderSheet
        visible={riderSheetOpen}
        onClose={() => setRiderSheetOpen(false)}
        riderName={riderName}
        riderPhone={riderPhone}
        onCommit={(name, phone) => { setRider(name, phone); setRiderSheetOpen(false) }}
        onClearToMyself={() => { clearRider(); setRiderSheetOpen(false) }}
      />
      <ScheduleSheet visible={scheduleSheetOpen} onClose={() => setScheduleSheetOpen(false)} onChange={setScheduledFor} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  backButton: { width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(20,23,26,0.08)',
    boxShadow: '0 2px 8px rgba(20,23,26,0.06), 0 1px 2px rgba(20,23,26,0.05)', alignItems: 'center', justifyContent: 'center' },
  pressedScale: { transform: [{ scale: 0.97 }] },
  headerText: { flex: 1 },
  title: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  subtitle: { ...typography.caption, color: colors.ink400, marginTop: 1 },
  riderPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface2, borderRadius: radii.full, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, maxWidth: 110 },
  riderPillText: { ...typography.caption, color: colors.ink900, fontFamily: fonts.bold },
  scheduleChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: colors.primarySubtle, borderRadius: radii.full, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, marginBottom: spacing.xs },
  scheduleChipText: { ...typography.caption, color: colors.primaryDark, fontFamily: fonts.bold },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: spacing.sm },
  routeCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primarySubtle, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.xs },
  routeText: { ...typography.body, color: colors.primaryDark, fontFamily: fonts.semibold, flex: 1 },
  sectionLabel: { ...sectionLabel, marginTop: spacing.xs },
  catRow: { flexGrow: 0, marginBottom: spacing.xs },
  catChip: { alignItems: 'center', gap: 4, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: 16, backgroundColor: colors.surface2, marginRight: spacing.xs, minWidth: 76 },
  catChipActive: { backgroundColor: colors.primarySubtle, borderWidth: 1, borderColor: colors.primary },
  catName: { ...typography.caption, color: colors.ink600, fontFamily: fonts.semibold },
  catNameActive: { color: colors.primaryDark },
  catSeatsRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  catSeats: { fontSize: 9, color: colors.ink400 },
  pkgHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  routeSummary: { ...typography.caption, color: colors.ink600, fontFamily: fonts.medium },
  pkgList: { gap: spacing.xs },
  pkgRowRec: { marginTop: spacing.sm, borderColor: colors.primary },
  recTag: { position: 'absolute', top: -10, left: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, borderRadius: radii.full, paddingHorizontal: spacing.sm + 2, paddingVertical: 3 },
  recTagText: { fontSize: 10, fontFamily: fonts.bold, letterSpacing: 0.3, color: colors.inkInverse },
  warnCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.warningLight, borderRadius: 16, padding: spacing.md },
  warnText: { ...typography.caption, flex: 1, color: colors.ink900, lineHeight: 17 },
  pkgRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface2, borderRadius: 16, borderWidth: 1, borderColor: 'transparent', padding: spacing.sm + 4 },
  pkgRowActive: { backgroundColor: colors.primarySubtle, borderColor: colors.primary },
  pkgIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  pkgIconWrapActive: { backgroundColor: colors.surface },
  pkgInfo: { flex: 1, gap: 2 },
  pkgTitle: { ...typography.label, color: colors.ink900, fontFamily: fonts.bold },
  pkgTitleActive: { color: colors.primaryDark },
  pkgMeta: { ...typography.caption, color: colors.ink400 },
  pkgFare: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  emptyPkg: { height: 64, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  emptyPkgText: { ...typography.body, color: colors.ink400 },
  fareCard: { backgroundColor: colors.surface2, borderRadius: 16, padding: spacing.md, gap: 4, marginTop: spacing.xs },
  fareCardTitle: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold },
  fareCardSub: { ...typography.caption, color: colors.ink400 },
  fareDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  fareTotalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fareTotalLabel: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  fareTotalValue: { ...typography.headline, color: colors.primaryDark, fontFamily: fonts.bold },
  fareTotalUnavailable: { ...typography.body, color: colors.ink400 },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderLight, backgroundColor: colors.bg },
  error: { ...typography.body, color: colors.error, marginBottom: spacing.xs, textAlign: 'center' },
  bookBtn: { backgroundColor: colors.primary, borderRadius: 16, paddingVertical: spacing.sm + 8, alignItems: 'center', justifyContent: 'center', minHeight: 54, boxShadow: '0 10px 24px rgba(14,143,163,0.28)' },
  disabled: { opacity: 0.5 },
  bookText: { ...typography.body, color: colors.inkInverse, fontFamily: fonts.bold },
})
