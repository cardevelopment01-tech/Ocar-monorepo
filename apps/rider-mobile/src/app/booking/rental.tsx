import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native'
import { useRouter } from 'expo-router'
import { goBack } from '@/lib/goBack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, { FadeIn, FadeOut, LinearTransition, useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated'
import { Button, Skeleton, VehicleIcon, font, h } from '@ocar/mobile-shared'
import { IconButton } from '@/components/ui'
import type { RentalPackage, VehicleCategory } from '@ocar/mobile-shared'
import { createBooking, fetchRentalPackages, fetchRoute, fetchVehicleCategories, fetchFareEstimate, resolveBookingError } from '@/features/booking/api'
import { recommendPackage, type PackageRecommendation } from '@/features/booking/recommendPackage'
import { useBookingDraftStore } from '@/features/booking/store'
import { socket } from '@/services/socket'
import { RiderSheet } from '@/features/booking/components/RiderSheet'
import { ScheduleSheet, formatPickupTime } from '@/features/booking/components/ScheduleSheet'
import { StopsList } from '@/features/booking/components/StopsList'
import { sectionLabel } from '@/theme/homeTokens'
import { CouponLine } from '@/features/offers/CouponLine'
import { OfferSheet } from '@/features/offers/OfferSheet'
import { PriceChangedBanner } from '@/features/offers/PriceChangedBanner'
import { useOfferPreview } from '@/features/offers/useOfferPreview'
import { bookAmount, bookingOfferFields, couponLineState, parseOfferNotApplicable, parsePriceChanged, priceChangedMessage, rentalPreviewRequest } from '@/features/offers/offerModel'

const MAX_STOPS = 3

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h_ = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h_} hr${h_ > 1 ? 's' : ''}` : `${h_}h ${m}m`
}

// Luxury carries the app's own gold "premium tier" signal — same gradient
// family as the Ocar Elite banner on Home — so it reads as genuinely premium.
function isPremiumSlug(slug: string) {
  return slug === 'luxury'
}

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient)
const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

// Package tiers scroll horizontally and some vehicles have more tiers than fit
// on screen. A fade + arrow at the trailing edge signals there's more to see —
// the arrow scrolls forward on tap, and both fade out smoothly once fully
// scrolled. Mirrors web's PackageTierScroller (apps/user/.../rental/page.tsx).
function PackageTierScroller({
  pkgs, selectedPkgId, recommendation, onSelect,
}: {
  pkgs: RentalPackage[]
  selectedPkgId: number | null
  recommendation: PackageRecommendation | null
  onSelect: (id: number) => void
}) {
  const scrollRef = useRef<ScrollView>(null)
  const offsetRef = useRef(0)
  const contentWidthRef = useRef(0)
  const layoutWidthRef = useRef(0)
  const arrowOpacity = useSharedValue(0)
  const [canScrollRight, setCanScrollRight] = useState(false)

  // Bring the selected package (the best fit, unless the rider chose another) to the middle of the visible window. It needs three
  // measurements (the chip, the window, the content), which arrive in any order, so each one asks to settle and it scrolls once all are in.
  const chipLayouts = useRef<Record<number, { x: number; w: number }>>({})
  const pendingCentre = useRef<number | null>(null)
  const hasCentred = useRef(false)
  const settle = useCallback(() => {
    const id = pendingCentre.current
    const chip = id === null ? undefined : chipLayouts.current[id]
    if (!chip || layoutWidthRef.current === 0 || contentWidthRef.current === 0) return
    const max = Math.max(0, contentWidthRef.current - layoutWidthRef.current)
    const x = Math.min(max, Math.max(0, chip.x + chip.w / 2 - layoutWidthRef.current / 2))
    pendingCentre.current = null
    scrollRef.current?.scrollTo({ x, animated: hasCentred.current })
    hasCentred.current = true
  }, [])
  useEffect(() => { pendingCentre.current = selectedPkgId; settle() }, [selectedPkgId, settle])

  const lastCanScroll = useRef<boolean | null>(null)
  const evaluate = useCallback(() => {
    const canScroll = contentWidthRef.current - offsetRef.current - layoutWidthRef.current > 4
    // Scroll events fire every 16ms; only the boolean flipping needs an animation + a render.
    if (canScroll === lastCanScroll.current) return
    lastCanScroll.current = canScroll
    arrowOpacity.value = withTiming(canScroll ? 1 : 0, { duration: 180 })
    setCanScrollRight(canScroll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetRef.current = e.nativeEvent.contentOffset.x
    evaluate()
  }, [evaluate])

  const fadeStyle = useAnimatedStyle(() => ({ opacity: arrowOpacity.value }))
  const arrowStyle = useAnimatedStyle(() => ({ opacity: arrowOpacity.value }))

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tierRow}
        contentContainerStyle={styles.tierRowContent}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onContentSizeChange={(w) => { contentWidthRef.current = w; evaluate(); settle() }}
        onLayout={(e) => { layoutWidthRef.current = e.nativeEvent.layout.width; evaluate(); settle() }}
      >
        {pkgs.map((pkg) => {
          const active = pkg.id === selectedPkgId
          const isRec = recommendation?.packageId === pkg.id
          return (
            <Pressable
              key={pkg.id}
              onPress={() => onSelect(pkg.id)}
              onLayout={(e) => { chipLayouts.current[pkg.id] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width }; settle() }}
              style={[styles.tierChip, active ? styles.tierChipActive : null]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              {isRec ? (
                <View style={styles.bestFitTag}>
                  <Text style={styles.bestFitText} numberOfLines={1}>Best fit</Text>
                </View>
              ) : null}
              <Text style={[styles.tierDuration, active ? styles.tierTextActive : null]} numberOfLines={1}>{formatDuration(pkg.durationMinutes)}</Text>
              <Text style={[styles.tierKm, active ? styles.tierKmActive : null]} numberOfLines={1}>{`${pkg.kmLimit} km`}</Text>
            </Pressable>
          )
        })}
      </ScrollView>

      <AnimatedGradient
        pointerEvents="none"
        colors={['rgba(247,246,241,0)', h.chip]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.tierFade, fadeStyle]}
      />
      <AnimatedPressable
        onPress={() => scrollRef.current?.scrollTo({ x: offsetRef.current + 140, animated: true })}
        accessibilityRole="button"
        accessibilityLabel="Show more packages"
        pointerEvents={canScrollRight ? 'auto' : 'none'}
        style={[styles.tierArrowBtn, arrowStyle]}
      >
        <Feather name="chevron-right" size={13} color={h.teal} />
      </AnimatedPressable>
    </View>
  )
}

// Matches web's /rental ("City Rides", apps/user/app/(main)/rental/page.tsx) --
// a self-contained booking screen (category + package + fare + book). Every
// vehicle is a row in one vertical list (never a horizontal carousel — options
// must never scroll out of view); tapping a row expands its package tiers
// inline as chips, so only one row is ever open at a time.
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
  // Every category's packages, fetched up front so every row can show a real
  // "from ₹X" before the rider taps anything.
  const [packagesByCat, setPackagesByCat] = useState<Record<number, RentalPackage[]>>({})
  const [pkgsLoading, setPkgsLoading] = useState(true)
  const [openCatId, setOpenCatId] = useState<number | null>(null)
  const [selectedPkgId, setSelectedPkgId] = useState<number | null>(null)
  const [userPickedPkg, setUserPickedPkg] = useState(false)
  const [estimate, setEstimate] = useState<Awaited<ReturnType<typeof fetchFareEstimate>> | null>(null)
  const [estLoading, setEstLoading] = useState(false)
  const [booking, setBooking] = useState(false)
  const [offerSheetOpen, setOfferSheetOpen] = useState(false)
  const [priceBanner, setPriceBanner] = useState<string | null>(null)
  const [bookError, setBookError] = useState<string | null>(null)
  const bookInFlightRef = useRef(false)

  useEffect(() => {
    fetchVehicleCategories()
      .then(setCategories)
      .catch(() => {})
  }, [])

  // Route pickup → stops → drop. Not traffic-aware: package tiers are coarse, so live
  // traffic wouldn't change the pick but would double routing cost per lookup.
  const [trip, setTrip] = useState<{ km: number; min: number } | null>(null)
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

  // Fetch every category's packages in parallel whenever the category list or city changes.
  const loadAllPackages = useCallback(async (cats: VehicleCategory[], cityId: number | null) => {
    setPkgsLoading(true)
    const entries = await Promise.allSettled(
      cats.map(async (cat) => [cat.id, await fetchRentalPackages(cat.id, cityId)] as const)
    )
    const next: Record<number, RentalPackage[]> = {}
    for (const r of entries) if (r.status === 'fulfilled') next[r.value[0]] = r.value[1]
    setPackagesByCat(next)
    setPkgsLoading(false)
  }, [])

  useEffect(() => { if (categories.length > 0) void loadAllPackages(categories, originCityId) }, [categories, originCityId, loadAllPackages])

  // Default-open the sedan-equivalent row (or the first category) once the list settles.
  useEffect(() => {
    setOpenCatId((prev) => {
      if (prev !== null && categories.some((c) => c.id === prev)) return prev
      if (categories.length === 0) return null
      return (categories.find((c) => c.slug === 'sedan') ?? categories[0])!.id
    })
  }, [categories])

  const openPackages = useMemo(
    () => (openCatId !== null ? (packagesByCat[openCatId] ?? []) : []),
    [openCatId, packagesByCat],
  )
  const recommendation = useMemo(
    () => (trip ? recommendPackage(openPackages, trip.km, trip.min) : null),
    [openPackages, trip],
  )

  useEffect(() => {
    if (userPickedPkg || !tripReady) return
    if (openPackages.length === 0) { setSelectedPkgId(null); return }
    setSelectedPkgId(recommendation?.packageId ?? openPackages[0]!.id)
  }, [openCatId, openPackages, recommendation, userPickedPkg, tripReady])

  useEffect(() => {
    if (selectedPkgId === null || openCatId === null) { setEstimate(null); return }
    let cancelled = false
    setEstLoading(true)
    setEstimate(null)
    const input: Parameters<typeof fetchFareEstimate>[0] = {
      categoryId: openCatId,
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
  }, [selectedPkgId, openCatId, originCityId])

  function toggleCategory(catId: number) {
    if (openCatId === catId) {
      setOpenCatId(null)
      setSelectedPkgId(null)
      return
    }
    setOpenCatId(catId)
    setUserPickedPkg(false)
    setSelectedPkgId(null)
  }

  const selectedPkg = openPackages.find((p) => p.id === selectedPkgId) ?? null
  // Offers: the server prices the chosen package again whenever the package, vehicle, route or a typed code changes.
  const offerRequest = useMemo(
    () => (openCatId !== null && selectedPkgId !== null && pickup && drop
      ? rentalPreviewRequest({ categoryId: openCatId, packageId: selectedPkgId, pickup, drop, stopCount: stops.length, scheduledFor })
      : null),
    [openCatId, selectedPkgId, pickup, drop, stops.length, scheduledFor],
  )
  const offers = useOfferPreview(offerRequest)
  const selectedFare = estimate?.breakdown.total ?? null
  const couponState = couponLineState({ status: offers.status, preview: offers.preview, typedCode: offers.typedCode, fullPrice: selectedFare })
  const payable = bookAmount(selectedFare, offers.preview)
  const canBook = openCatId !== null && selectedPkgId !== null && estimate !== null && !estLoading && !!drop && !booking && !offers.bookLocked

  async function handleBook() {
    if (!pickup || !drop || openCatId === null || selectedPkgId === null || bookInFlightRef.current) return
    bookInFlightRef.current = true
    setBooking(true)
    setBookError(null)
    try {
      const input: Parameters<typeof createBooking>[0] = {
        categoryId: openCatId,
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
      Object.assign(input, bookingOfferFields({ preview: offers.preview, typedCode: offers.typedCode, choice: offers.choice }))

      const result = await createBooking(input)
      socket.emit('join:ride', result.rideId)
      const rideId = result.rideId
      resetDraft()
      router.replace(`/ride/${rideId}`)
    } catch (err) {
      const changed = parsePriceChanged(err)
      const refused = parseOfferNotApplicable(err)
      if (changed) {
        // Say what changed, re-check, and let the rider decide: never rebook on their behalf.
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

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="arrow-left" label="Go back" onPress={() => goBack(router)} />
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
          <Feather name="user" size={16} color={h.ivory} />
          <Text style={styles.riderPillText} numberOfLines={1}>{bookingForOther ? riderName : 'For me'}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>

        {/* Trip summary card */}
        <View style={styles.tripCard}>
          <View style={styles.tripRow}>
            <Pressable onPress={() => setScheduleSheetOpen(true)} style={styles.scheduleChip} accessibilityRole="button">
              <Feather name="clock" size={12} color={h.tealText} />
              <Text style={styles.scheduleChipText}>{scheduledFor ? formatPickupTime(new Date(scheduledFor)) : 'Now'}</Text>
              {scheduledFor ? (
                <Pressable onPress={() => setScheduledFor(null)} hitSlop={8} accessibilityLabel="Reset to ride now">
                  <Feather name="x" size={12} color={h.tealText} />
                </Pressable>
              ) : null}
            </Pressable>
            {trip ? <Text style={styles.tripMeta}>{`${trip.km} km · ~${formatDuration(trip.min)}`}</Text> : null}
          </View>
          <View style={styles.tripDivider} />
          <Pressable onPress={() => router.push('/booking/add-stop')} style={styles.routeRow}>
            <Feather name="navigation" size={13} color={h.tealCta} />
            <Text style={styles.routeText} numberOfLines={1}>{drop?.address ?? 'Destination'}</Text>
          </Pressable>
        </View>

        <StopsList
          stops={stops}
          maxStops={MAX_STOPS}
          onAdd={() => router.push('/booking/add-stop')}
          onRemove={removeStop}
          onSwap={swapStop}
        />

        {/* Vehicle list — every option visible on one vertical scroll */}
        <View style={styles.vehHeader}>
          <Text style={styles.sectionLabel}>Choose your ride</Text>
          <Text style={styles.vehCount}>{categories.length} options</Text>
        </View>

        {categories.map((cat) => {
          const isOpen = openCatId === cat.id
          const pkgs = packagesByCat[cat.id] ?? []
          const fromFare = pkgs.length > 0 ? Math.min(...pkgs.map((p) => p.packageFare)) : null
          const premium = isPremiumSlug(cat.slug)
          const noPkgs = !pkgsLoading && pkgs.length === 0

          return (
            <Animated.View key={cat.id} layout={LinearTransition.duration(220)} style={[styles.vehCard, isOpen ? styles.vehCardOpen : null]}>
              <Pressable
                onPress={() => !noPkgs && toggleCategory(cat.id)}
                disabled={noPkgs}
                style={[styles.vehRow, noPkgs ? styles.vehRowDisabled : null]}
                accessibilityRole="button"
                accessibilityState={{ selected: isOpen, disabled: noPkgs }}
              >
                {premium ? (
                  <LinearGradient
                    colors={['#F3D9A6', '#E0B662', '#C9974A']}
                    locations={[0, 0.55, 1]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.iconWrap}
                  >
                    <VehicleIcon slug={cat.slug} size={26} />
                  </LinearGradient>
                ) : (
                  <View style={[styles.iconWrap, isOpen ? styles.iconWrapOpen : null]}>
                    <VehicleIcon slug={cat.slug} size={26} />
                  </View>
                )}

                <View style={styles.vehInfo}>
                  <View style={styles.vehNameRow}>
                    <Text style={styles.vehName}>{cat.displayName}</Text>
                    {premium ? (
                      <View style={styles.premiumBadge}>
                        <Feather name="star" size={8} color={h.gold} />
                        <Text style={styles.premiumBadgeText}>Premium fleet</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.vehSeatsRow}>
                    <Feather name="users" size={9} color={h.ivoryFaint} />
                    <Text style={styles.vehSeats}>{cat.maxPassengers} seats</Text>
                  </View>
                </View>

                <View style={styles.vehFareBlock}>
                  {noPkgs ? (
                    <Text style={styles.vehNoPkgs}>No packages</Text>
                  ) : pkgsLoading ? (
                    <Skeleton width={56} height={16} />
                  ) : isOpen && selectedPkg ? (
                    <Text style={styles.vehFareSelected}>{`₹${Math.round(selectedPkg.packageFare)}`}</Text>
                  ) : fromFare != null ? (
                    <Text style={styles.vehFareFrom}>{`from ₹${Math.round(fromFare)}`}</Text>
                  ) : null}
                </View>
                <Feather
                  name="chevron-down"
                  size={14}
                  color={isOpen ? h.teal : h.line13}
                  style={isOpen ? styles.chevronOpen : null}
                />
              </Pressable>

              {isOpen ? (
                <Animated.View
                  entering={FadeIn.duration(180)}
                  exiting={FadeOut.duration(140)}
                  layout={LinearTransition.duration(220)}
                  style={styles.tray}
                >
                  {pkgsLoading ? (
                    <View style={styles.trayLoadingRow}>
                      <Skeleton width={72} height={48} borderRadius={12} />
                      <Skeleton width={72} height={48} borderRadius={12} />
                      <Skeleton width={72} height={48} borderRadius={12} />
                    </View>
                  ) : (
                    <>
                      <Text style={styles.trayLabel}>{`Package · ${pkgs.length} tiers`}</Text>
                      <PackageTierScroller
                        pkgs={pkgs}
                        selectedPkgId={selectedPkgId}
                        recommendation={recommendation}
                        onSelect={(id) => { setUserPickedPkg(true); setSelectedPkgId(id) }}
                      />

                      {selectedPkg ? (
                        <>
                          <View style={styles.trayDivider} />
                          <View style={styles.trayTotalRow}>
                            <View style={styles.trayTotalInfo}>
                              <Text style={styles.trayTotalMeta} numberOfLines={1}>
                                {`${formatDuration(selectedPkg.durationMinutes)} · ${selectedPkg.kmLimit} km · `}
                                <Text style={styles.trayExtra}>{`extra ₹${selectedPkg.extraPerKm}/km`}</Text>
                              </Text>
                              {estimate != null && estimate.surgeMultiplier > 1 ? (
                                <View style={styles.surgeRow}>
                                  <Feather name="zap" size={9} color={h.goldInk} />
                                  <Text style={styles.surgeText}>{`${estimate.surgeMultiplier}× surge`}</Text>
                                </View>
                              ) : null}
                            </View>
                            {estLoading ? (
                              <Skeleton width={64} height={22} />
                            ) : estimate != null ? (
                              <Text style={styles.trayTotalValue}>{`₹${Math.round(estimate.breakdown.total)}`}</Text>
                            ) : (
                              <Text style={styles.trayTotalUnavailable}>-</Text>
                            )}
                          </View>
                        </>
                      ) : null}

                      {recommendation?.exceeds && trip && (recommendation.overKm > 0 || recommendation.overMin > 0) ? (
                        <View style={styles.warnCard}>
                          <Feather name="info" size={13} color={h.goldInk} />
                          <Text style={styles.warnText}>
                            {`Your route (~${trip.km} km, ${formatDuration(trip.min)}) is longer than the biggest package.${
                              recommendation.overKm > 0 ? ` About ${recommendation.overKm} km over` : ''
                            }${recommendation.overKm > 0 && recommendation.overMin > 0 ? ' and' : ''}${
                              recommendation.overMin > 0 ? ` ${formatDuration(recommendation.overMin)} over` : ''
                            } will be charged as extra.`}
                          </Text>
                        </View>
                      ) : null}
                    </>
                  )}
                </Animated.View>
              ) : null}
            </Animated.View>
          )
        })}

        <Text style={styles.footnote}>
          Waiting time is <Text style={styles.footnoteStrong}>covered within your rental package</Text>. Running over is billed as an hourly overage.
        </Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {priceBanner ? <PriceChangedBanner message={priceBanner} onDismiss={() => setPriceBanner(null)} /> : null}
        {selectedPkg ? <CouponLine state={couponState} onOpenSheet={() => setOfferSheetOpen(true)} onRemove={offers.removeCode} onRetry={offers.retry} /> : null}
        {bookError ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">{bookError}</Text>
        ) : null}
        <Button
          variant="cta"
          label={
            !drop
              ? 'Add a drop-off to continue'
              : !selectedPkg
              ? 'Select a package'
              : estimate != null
              ? `Book · ₹${Math.round(payable ?? estimate.breakdown.total)}`
              : 'Book'
          }
          onPress={() => void handleBook()}
          disabled={!canBook}
          loading={booking}
        />
      </View>

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
  screen: { flex: 1, backgroundColor: h.canvas },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  backButtonUnused: { width: 40, height: 40, borderRadius: 20, backgroundColor: h.surface, borderWidth: 1, borderColor: h.line10, boxShadow: '0 2px 8px rgba(20,23,26,0.06), 0 1px 2px rgba(20,23,26,0.05)', alignItems: 'center', justifyContent: 'center' },
  pressedScale: { transform: [{ scale: 0.97 }] },
  headerText: { flex: 1 },
  title: { fontFamily: font.b, fontSize: 17, lineHeight: 24, color: h.ivory },
  subtitle: { fontFamily: font.m, fontSize: 12.5, lineHeight: 18, color: h.ivoryDim, marginTop: 1 },
  riderPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: h.chip, borderRadius: 9999, paddingHorizontal: 8 + 2, paddingVertical: 4 + 2, maxWidth: 110 },
  riderPillText: { fontSize: 12.5, lineHeight: 18, color: h.ivory, fontFamily: font.b },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24, gap: 8 },

  tripCard: { backgroundColor: h.surface, borderWidth: 1, borderColor: h.line10, borderRadius: 24, padding: 8 + 4, boxShadow: '0 3px 12px rgba(20,23,26,0.07)', gap: 8 },
  tripRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tripMeta: { fontSize: 12.5, lineHeight: 18, color: h.ivoryDim, fontFamily: font.sb },
  tripDivider: { height: 1, backgroundColor: h.line08 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeText: { fontSize: 14.5, lineHeight: 21, color: h.ivory, fontFamily: font.b, flex: 1 },
  scheduleChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: h.chip, borderRadius: 9999, paddingHorizontal: 8 + 2, paddingVertical: 4 + 2 },
  scheduleChipText: { fontSize: 12.5, lineHeight: 18, color: h.ivory, fontFamily: font.b },

  vehHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 },
  sectionLabel: { ...sectionLabel },
  vehCount: { fontSize: 12.5, lineHeight: 18, color: h.ivoryFaint, fontFamily: font.sb },

  vehCard: { backgroundColor: h.surface, borderWidth: 1, borderColor: h.line10, borderRadius: 24, overflow: 'hidden', boxShadow: '0 2px 8px rgba(20,23,26,0.04)' },
  vehCardOpen: { borderColor: '#0B8296', boxShadow: '0 8px 24px rgba(14,143,163,0.14)' },
  vehRow: { flexDirection: 'row', alignItems: 'center', gap: 8 + 4, padding: 8 + 4 },
  vehRowDisabled: { opacity: 0.4 },
  iconWrap: { width: 52, height: 44, borderRadius: 12, backgroundColor: h.chip, alignItems: 'center', justifyContent: 'center' },
  iconWrapOpen: { backgroundColor: h.chip },
  vehInfo: { flex: 1, gap: 2, minWidth: 0 },
  vehNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  vehName: { fontSize: 16, fontFamily: font.b, color: h.ivory },
  premiumBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FBF3E6', borderRadius: 9999, paddingHorizontal: 7, paddingVertical: 2 },
  premiumBadgeText: { fontSize: 12, fontFamily: font.sb, color: '#8A6323' },
  vehSeatsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  vehSeats: { fontFamily: font.m, fontSize: 12.5, lineHeight: 18, color: h.muted },
  vehFareBlock: { alignItems: 'flex-end', minWidth: 56 },
  vehFareFrom: { fontSize: 15, fontFamily: font.b, color: h.ivory },
  vehFareSelected: { fontSize: 15, fontFamily: font.b, color: h.ivory },
  vehNoPkgs: { fontSize: 11, fontFamily: font.sb, color: h.ivoryFaint },
  chevronOpen: { transform: [{ rotate: '180deg' }] },

  tray: { backgroundColor: h.chip, marginHorizontal: 6, marginBottom: 6, borderRadius: 18, padding: 8 + 4 },
  trayLoadingRow: { flexDirection: 'row', gap: 4 + 4 },
  trayLabel: { fontSize: 13, fontFamily: font.sb, color: h.ivory, marginBottom: 8 },
  tierRow: { flexGrow: 0, marginBottom: 8 + 4 },
  tierRowContent: { gap: 4 + 2, paddingTop: 4 },
  tierChip: { minWidth: 64, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 12, backgroundColor: h.surface, borderWidth: 1, borderColor: h.line08, alignItems: 'center' },
  tierFade: { position: 'absolute', top: 4, bottom: 8 + 4, right: 0, width: 44 },
  tierArrowBtn: { position: 'absolute', top: 4, right: 4, width: 26, height: 26, borderRadius: 9999, backgroundColor: h.surface, alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(14,143,163,0.22)' },
  tierChipActive: { backgroundColor: '#F3FAFB', borderColor: '#0B8296', boxShadow: '0 6px 16px rgba(14,143,163,0.18)' },
  tierDuration: { fontSize: 13.5, fontFamily: font.b, color: h.ivory },
  tierKm: { fontSize: 11.5, color: h.ivoryFaint },
  tierTextActive: { color: '#0A7788' },
  tierKmActive: { color: 'rgba(10,119,136,0.72)' },
  bestFitTag: { alignSelf: 'center', backgroundColor: '#0B8296', borderRadius: 9999, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 4 },
  bestFitText: { fontSize: 11, fontFamily: font.b, color: '#FFFFFF', letterSpacing: 0.3, flexShrink: 0 },
  trayDivider: { height: 1, backgroundColor: h.line08, marginBottom: 8 },
  trayTotalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  trayTotalInfo: { flex: 1, minWidth: 0 },
  trayTotalMeta: { fontSize: 11.5, color: h.ivoryDim, fontFamily: font.m },
  trayExtra: { fontFamily: font.b, color: '#0A7788' },
  surgeRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  surgeText: { fontSize: 10, fontFamily: font.b, color: h.goldInk },
  trayTotalValue: { fontSize: 19, fontFamily: font.b, color: h.teal, letterSpacing: -0.3 },
  trayTotalUnavailable: { fontSize: 14, color: h.ivoryFaint },

  warnCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: h.goldWash, borderRadius: 18, padding: 16, marginTop: 8 + 4 },
  warnText: { fontFamily: font.m, fontSize: 12.5, lineHeight: 18, flex: 1, color: h.ivory },

  footnote: { fontFamily: font.m, fontSize: 12.5, lineHeight: 18, color: h.ivoryFaint, marginTop: 4 },
  footnoteStrong: { color: h.ivoryDim, fontFamily: font.sb },

  footer: { paddingHorizontal: 24, paddingTop: 8, borderTopWidth: 1, borderTopColor: h.line08, backgroundColor: h.canvas },
  error: { fontFamily: font.r, fontSize: 14.5, lineHeight: 21, color: h.danger, marginBottom: 4, textAlign: 'center' },
  bookBtn: { backgroundColor: h.tealCta, borderRadius: 16, paddingVertical: 8 + 8, alignItems: 'center', justifyContent: 'center', minHeight: 54, boxShadow: '0 10px 24px rgba(14,143,163,0.28)' },
  disabled: { opacity: 0.5 },
  bookText: { fontSize: 14.5, lineHeight: 21, color: '#FFFFFF', fontFamily: font.b },
})
