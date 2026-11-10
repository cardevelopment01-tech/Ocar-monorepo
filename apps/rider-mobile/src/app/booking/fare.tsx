import { useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import { goBack } from '@/lib/goBack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, ErrorState, font, h, shadow, spacing } from '@ocar/mobile-shared'
import { Chip, IconButton } from '@/components/ui'
import { CategoryCard, type CategoryEta } from '@/features/booking/components/CategoryCard'
import { SelectRideMap } from '@/features/booking/components/SelectRideMap'
import { useFareEstimates } from '@/features/booking/hooks/useFareEstimates'
import { useBookingDraftStore } from '@/features/booking/store'
import { formatPickupTime } from '@/lib/formatPickupTime'
import { resolveSelectedCategory } from '@/features/booking/resolveSelectedCategory'
import { createBooking, resolveBookingError } from '@/features/booking/api'
import { CouponLine } from '@/features/offers/CouponLine'
import { OfferSheet } from '@/features/offers/OfferSheet'
import { PriceChangedBanner } from '@/features/offers/PriceChangedBanner'
import { useOfferPreview } from '@/features/offers/useOfferPreview'
import {
  bookAmount, bookingOfferFields, couponLineState, formatRupees, parseOfferNotApplicable, parsePriceChanged, priceChangedMessage, savingsLabel,
} from '@/features/offers/offerModel'
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
const MAP_HEIGHT_RATIO = 0.3

const RIDE_TYPE_LABEL = { one_way: 'One way', round_trip: 'Round trip', rental: 'City ride' } as const

// Module scope: an inline ItemSeparatorComponent is a new component type every render, so React
// unmounted and remounted every separator whenever the nearby-driver poll re-rendered the screen.
function Divider() {
  return <View style={styles.divider} />
}

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
  const setScheduledFor = useBookingDraftStore((s) => s.setScheduledFor)
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
  const [offerSheetOpen, setOfferSheetOpen] = useState(false)
  const [priceBanner, setPriceBanner] = useState<string | null>(null)

  // Hide any category whose estimate fetch failed (e.g. no rate card for this
  // ride_type -- auto_rickshaw only has `rental`) once loading has settled;
  // keep showing all cards during the initial load so skeletons still render.
  // Matches web's identical fix (apps/user/app/(main)/select-ride/page.tsx) --
  // without this, a rental-only category shows up here too and 422s on booking.
  const visibleCategories = useMemo(
    () => categories.filter((cat) => loading || estimates[cat.id] !== undefined),
    [categories, loading, estimates],
  )

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

  // Cars only matter for a ride NOW (same rule as liveCheck below): a card with none nearby is never the default pick.
  const noCarIds = driversPolled && !scheduledFor ? visibleCategories.filter((c) => (driverEta[c.id]?.count ?? 0) === 0).map((c) => c.id) : []
  const effectiveSelected = resolveSelectedCategory(visibleCategories.map((c) => c.id), selectedCategoryId, noCarIds)
  const selectedFare = effectiveSelected != null
    ? (isReturnCab ? returnCabEstimates[effectiveSelected] : estimates[effectiveSelected])?.breakdown.total
    : undefined
  // Offers: the server prices the selected ride again whenever it changes (category, route, schedule, a typed code or
  // the rider's choice). A failed check never blocks booking at the plain fare.
  const offerRequest = useMemo(
    () => (effectiveSelected != null && pickup && drop && distanceKm != null && durationMin != null
      ? {
          categoryId: effectiveSelected, rideType, distanceKm, durationMin, paymentChannel: 'cash' as const,
          originLat: pickup.lat, originLng: pickup.lng, destinationLat: drop.lat, destinationLng: drop.lng,
          ...(rideType === 'round_trip' && tripHours !== null ? { tripHours } : {}),
          ...(stops.length > 0 ? { stopCount: stops.length } : {}),
          ...(isReturnCab ? { isReturnCab: true } : {}),
          ...(scheduledFor ? { scheduledFor } : {}),
        }
      : null),
    [effectiveSelected, rideType, distanceKm, durationMin, pickup, drop, tripHours, stops.length, isReturnCab, scheduledFor],
  )
  const offers = useOfferPreview(offerRequest)
  const couponState = couponLineState({ status: offers.status, preview: offers.preview, typedCode: offers.typedCode, fullPrice: selectedFare ?? null })
  const payable = bookAmount(selectedFare ?? null, offers.preview)
  const hasOffer = couponState.kind === 'applied' && payable != null && selectedFare != null && payable < selectedFare
  // Nearby cars only matter for a ride NOW. A ride booked for later is dispatched shortly before its time, so an empty
  // street at this moment must not stop the rider from booking it.
  const liveCheck = driversPolled && !scheduledFor
  const allUnavailable = liveCheck && visibleCategories.length > 0 && visibleCategories.every((c) => (driverEta[c.id]?.count ?? 0) === 0)
  const selectedNoCars = liveCheck && effectiveSelected != null && (driverEta[effectiveSelected]?.count ?? 0) === 0
  const selectedName = visibleCategories.find((c) => c.id === effectiveSelected)?.displayName
  const canBook = effectiveSelected != null && selectedFare != null && !booking && !selectedNoCars && !offers.bookLocked

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
      Object.assign(input, bookingOfferFields({ preview: offers.preview, typedCode: offers.typedCode, choice: offers.choice }))

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
      const changed = parsePriceChanged(err)
      const refused = parseOfferNotApplicable(err)
      if (changed) {
        // Say what changed and why, re-check, and let the rider decide: never rebook on their behalf (design review D8).
        setPriceBanner(priceChangedMessage(changed, offers.preview?.payable ?? null, offers.typedCode || offers.preview?.applied?.code || null))
        offers.retry()
      } else if (refused) {
        setBookError(refused.message)
        offers.retry()
      } else {
        setBookError(resolveBookingError(err))
      }
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
          <IconButton icon="arrow-left" label="Go back" onPress={() => goBack(router)} />
          {pickup && drop ? (
            <View style={styles.breadcrumb}>
              <Pressable onPress={() => goBack(router)} style={styles.breadcrumbHalf}>
                <Text style={styles.breadcrumbOrigin} numberOfLines={1}>{pickup.address}</Text>
              </Pressable>
              <Feather name="chevron-right" size={12} color={h.faint} />
              <Pressable onPress={() => goBack(router)} style={styles.breadcrumbHalf}>
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
              <Chip label={RIDE_TYPE_LABEL[rideType]} />
            </View>
            <View style={styles.metaRow}>
              {distanceKm != null && durationMin != null ? (
                <Text style={styles.subtitle}>
                  {rideType === 'round_trip'
                    ? `${(distanceKm * 2).toFixed(1)} km total · ${Math.round(durationMin)} min · ${tripHours}h`
                    : `${distanceKm.toFixed(1)} km · ${Math.round(durationMin)} min`}
                </Text>
              ) : null}
            </View>
            {scheduledFor ? (
              <View style={styles.scheduledNote}>
                <Feather name="clock" size={13} color={h.tealText} />
                <Text style={styles.scheduledNoteText}>Pickup {formatPickupTime(new Date(scheduledFor))}</Text>
                <Pressable onPress={() => setScheduledFor(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Reset to ride now">
                  <Feather name="x" size={14} color={h.tealText} />
                </Pressable>
              </View>
            ) : null}
          </View>

          {allUnavailable ? (
            <View style={styles.noDriversBanner}>
              <Feather name="clock" size={14} color={h.goldInk} />
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
              ItemSeparatorComponent={Divider}
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
                    loading={loading && estimates[item.id] === undefined}
                    selected={!isReturnCab && effectiveSelected === item.id}
                    onPress={() => { setSelectedCategoryId(item.id); setIsReturnCab(false) }}
                    eta={driverEta[item.id] ?? null}
                    disabled={noCars}
                    {...(hasOffer && !isReturnCab && effectiveSelected === item.id && offers.preview && payable != null
                      ? { fareTotal: payable, grossFare: offers.preview.fareTotal, offerSavingText: `Save ${formatRupees(offers.preview.discount)}${offers.preview.applied?.code ? ` with ${offers.preview.applied.code}` : ''}` }
                      : { fareTotal: estimates[item.id]?.breakdown.total ?? null })}
                  />
                )
              }}
            />
          )}

          {/* Fixed footer within the sheet -- Book never drifts with list length. */}
          <View style={[styles.sheetFooter, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            {/* Idle (no offer on the ride): Cash and Offers share one row. Any other offer state keeps its full-width line below Cash. */}
            <View style={styles.payRow}>
              <Pressable
                onPress={() => { setPaymentNote('Cash only for now'); setTimeout(() => setPaymentNote(null), 2000) }}
                style={({ pressed }) => [styles.payBtn, pressed ? styles.pressedScale : null]}
                accessibilityRole="button"
                accessibilityLabel="Payment method: Cash"
              >
                <Feather name="credit-card" size={18} color={h.ivory} />
                <Text style={styles.payText}>Cash</Text>
                <Feather name="chevron-down" size={16} color={h.faint} style={styles.payChev} />
              </Pressable>
              {couponState.kind === 'idle' ? (
                <Pressable
                  onPress={() => setOfferSheetOpen(true)}
                  style={({ pressed }) => [styles.payBtn, pressed ? styles.pressedScale : null]}
                  accessibilityRole="button"
                  accessibilityLabel="Offers. Have a code? Add an offer code"
                >
                  <Feather name="tag" size={18} color={h.tealText} />
                  <Text style={styles.payText} numberOfLines={1}>Offers</Text>
                  <Feather name="chevron-right" size={16} color={h.faint} style={styles.payChev} />
                </Pressable>
              ) : null}
            </View>
            {paymentNote ? <Text style={styles.paymentNote}>{paymentNote}</Text> : null}
            {priceBanner ? <PriceChangedBanner message={priceBanner} onDismiss={() => setPriceBanner(null)} /> : null}
            {couponState.kind !== 'idle' ? <CouponLine state={couponState} onOpenSheet={() => setOfferSheetOpen(true)} onRemove={offers.removeCode} onRetry={offers.retry} /> : null}
            {bookError ? (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {bookError}
              </Text>
            ) : null}
            <Button
              variant="cta"
              label={
                allUnavailable
                  ? 'No drivers available'
                  : payable != null
                  ? `Book ${selectedName ?? ''}${selectedName ? ' · ' : '· '}${formatRupees(payable)}`
                  : 'Book'
              }
              onPress={() => void handleBook()}
              disabled={!canBook}
              loading={booking}
              accessibilityLabel={hasOffer && payable != null && selectedFare != null ? `Book this ride, ${savingsLabel(selectedFare, payable)}` : 'Book this ride'}
            />
            <OfferSheet
              visible={offerSheetOpen}
              onClose={() => setOfferSheetOpen(false)}
              applied={offers.preview?.applied ?? null}
              alternatives={offers.preview?.alternatives ?? []}
              ineligible={offers.preview?.ineligible ?? []}
              codeMessage={couponState.kind === 'rejected' ? couponState.message : null}
              checking={offers.status === 'loading'}
              onApplyCode={offers.applyCode}
              onChoose={offers.chooseOffer}
              onRemove={offers.preview?.applied?.kind === 'auto' ? offers.removeAuto : offers.removeCode}
            />
          </View>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: h.canvas },
  mapSection: { width: '100%' },
  headerRow: { position: 'absolute', left: 18, right: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  breadcrumb: { flex: 1, height: 44, backgroundColor: h.surface, borderRadius: 22, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 4, boxShadow: shadow.sm },
  breadcrumbHalf: { flex: 1, minWidth: 0 },
  breadcrumbOrigin: { fontFamily: font.m, fontSize: 12.5, color: h.muted },
  breadcrumbDest: { fontFamily: font.b, fontSize: 12.5, color: h.ivory },
  pressedScale: { transform: [{ scale: 0.97 }] },
  sheetShadowWrap: { flex: 1, marginTop: -28, borderTopLeftRadius: 28, borderTopRightRadius: 28, boxShadow: shadow.md },
  sheet: { flex: 1, backgroundColor: h.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  sheetHeader: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 6 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.12)', alignSelf: 'center', marginBottom: 14 },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaRow: { marginTop: 2 },
  scheduledNote: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 8, minHeight: 36, backgroundColor: h.tealWash, borderRadius: 999, paddingHorizontal: 14 },
  scheduledNoteText: { fontFamily: font.sb, fontSize: 12.5, color: h.tealText },
  noDriversBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 18, marginBottom: 6, backgroundColor: h.goldWash, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14 },
  noDriversText: { fontFamily: font.sb, fontSize: 12.5, color: h.goldInk, flex: 1 },
  noDriversAction: { fontFamily: font.b, fontSize: 12.5, color: h.goldInk, textDecorationLine: 'underline' },
  title: { fontFamily: font.xb, fontSize: 20, letterSpacing: -0.3, color: h.ivory },
  subtitle: { fontFamily: font.m, fontSize: 12.5, color: h.muted, fontVariant: ['tabular-nums'] },
  listFlex: { flex: 1 },
  list: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12 },
  returnCabSection: { marginBottom: 4 },
  returnCabLabel: { fontFamily: font.sb, fontSize: 14, color: h.live, marginHorizontal: 2, marginBottom: 10 },
  returnCabDivider: { height: 1, backgroundColor: h.line07, marginTop: 2, marginBottom: 14 },
  divider: { height: 0 },
  skeletonCard: { height: 92, borderRadius: 20, backgroundColor: h.chip, marginBottom: 12 },
  sheetFooter: { paddingHorizontal: 18, paddingTop: 12, borderTopWidth: 1, borderTopColor: h.line06 },
  payRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  payBtn: { flex: 1, height: 48, borderRadius: 16, backgroundColor: h.chip, borderWidth: 1, borderColor: h.line06, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  payText: { fontFamily: font.sb, fontSize: 14, color: h.ivory, flexShrink: 1 },
  payChev: { marginLeft: 'auto' },
  paymentNote: { fontFamily: font.m, fontSize: 12.5, color: h.muted, textAlign: 'center', marginBottom: 8 },
  error: { fontFamily: font.m, fontSize: 14, color: h.danger, marginBottom: 8 },
})
