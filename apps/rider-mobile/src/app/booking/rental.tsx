import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { goBack } from '@/lib/goBack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated'
import { Button, Skeleton, VehicleIcon, font, h } from '@ocar/mobile-shared'
import { IconButton } from '@/components/ui'
import { PackageSlider } from '@/components/ui/PackageSlider'
import type { RentalPackage, VehicleCategory } from '@ocar/mobile-shared'
import { createBooking, fetchRentalPackages, fetchRoute, fetchVehicleCategories, fetchFareEstimate, resolveBookingError } from '@/features/booking/api'
import { estimateOverage, recommendPackage } from '@/features/booking/recommendPackage'
import { MAX_STOPS } from '@/features/booking/constants'
import { formatDuration } from '@/features/booking/format'
import { useBookingDraftStore } from '@/features/booking/store'
import { socket } from '@/services/socket'
import { RiderSheet } from '@/features/booking/components/RiderSheet'
import { ScheduleSheet, formatPickupTime } from '@/features/booking/components/ScheduleSheet'
import { RouteRail, StopsSummaryRow } from '@/features/booking/components/StopsList'
import { sectionLabel } from '@/theme/homeTokens'
import { CouponLine } from '@/features/offers/CouponLine'
import { OfferSheet } from '@/features/offers/OfferSheet'
import { PriceChangedBanner } from '@/features/offers/PriceChangedBanner'
import { useOfferPreview } from '@/features/offers/useOfferPreview'
import { bookAmount, bookingOfferFields, formatRupees, type CouponLineState, couponLineState, parseOfferNotApplicable, parsePriceChanged, priceChangedMessage, rentalPreviewRequest } from '@/features/offers/offerModel'

// Luxury is an ordinary row in the list; it only carries a small gold Premium chip after the seat count.
function isPremiumSlug(slug: string) {
  return slug === 'luxury'
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
  // Which vehicle and package the estimate in state is for, so the Book button never shows the previous vehicle's price while the new one loads.
  const [estimateKey, setEstimateKey] = useState<string | null>(null)
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
      .then((est) => { if (!cancelled) { setEstimate(est); setEstimateKey(`${openCatId}:${selectedPkgId}`) } })
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

  // What the screen SHOWS as selected. The logic below still waits for selectedPkgId, but switching vehicles resets it to
  // null for a moment before the effect picks the best fit again; showing that gap made the tray, the Cash and Offers
  // row and the Book button blink on every switch. This mirrors that effect, so the right package shows at once.
  const shownPkgId = selectedPkgId ?? (!userPickedPkg && tripReady && openPackages.length > 0 ? (recommendation?.packageId ?? openPackages[0]!.id) : null)
  const selectedPkg = openPackages.find((p) => p.id === shownPkgId) ?? null
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
  // Every package or vehicle change restarts the offers check, so the state flips to 'loading' for a moment each time. The
  // footer must not follow that: remember the last settled answer and lay out by it, so the Offers button, its label and
  // the message row stay put (and an off-offers server never flashes the button in and out).
  const settledKind = useRef<CouponLineState['kind'] | null>(null)
  const settledApplied = useRef<{ label: string } | null>(null)
  if (couponState.kind !== 'loading') {
    settledKind.current = couponState.kind
    settledApplied.current = couponState.kind === 'applied' ? { label: couponState.auto ? 'Best offer' : (couponState.offer.code ?? couponState.offer.name) } : null
  }
  const layoutKind = couponState.kind === 'loading' ? settledKind.current : couponState.kind
  const offersAvailable = layoutKind !== null && layoutKind !== 'off'
  const appliedOffer = couponState.kind === 'applied' ? couponState.offer : null
  const shownApplied = couponState.kind === 'loading' ? settledApplied.current : (couponState.kind === 'applied' ? settledApplied.current : null)
  const offerLabel = shownApplied ? shownApplied.label : 'Offers'
  const openCategoryName = categories.find((c) => c.id === openCatId)?.displayName ?? ''
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
          <Text style={styles.subtitle} numberOfLines={1}>Book a driver by the hour</Text>
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

        {/* Route card: pickup, ONE stops summary row (never grows with the number of stops), drop. */}
        <View style={styles.tripCard}>
          <View style={styles.tripRow}>
            <Pressable onPress={() => setScheduleSheetOpen(true)} style={styles.scheduleChip} accessibilityRole="button">
              <Feather name="clock" size={15} color={h.tealText} />
              <Text style={styles.scheduleChipText}>{scheduledFor ? formatPickupTime(new Date(scheduledFor)) : 'Now'}</Text>
              {scheduledFor ? (
                <Pressable onPress={() => setScheduledFor(null)} hitSlop={8} accessibilityLabel="Reset to ride now">
                  <Feather name="x" size={13} color={h.tealText} />
                </Pressable>
              ) : null}
            </Pressable>
            {trip ? <Text style={styles.tripMeta}>{`${trip.km} km · ~${formatDuration(trip.min)}`}</Text> : null}
          </View>

          <View style={[styles.routeRow, { height: 38 }]}>
            <RouteRail line="down"><View style={styles.pickupDot} /></RouteRail>
            <Text style={styles.routeText} numberOfLines={1}>{pickup?.address ?? 'Pickup location'}</Text>
          </View>
          <StopsSummaryRow stops={stops} maxStops={MAX_STOPS} onEdit={() => router.push('/booking/plan-stops')} onAdd={() => router.push('/booking/add-stop')} />
          <View style={[styles.routeRow, { height: 38 }]}>
            <RouteRail line="up"><View style={styles.dropDot} /></RouteRail>
            <Text style={styles.routeText} numberOfLines={1}>{drop?.address ?? 'Destination'}</Text>
          </View>
        </View>

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
                style={({ pressed }) => [styles.vehRow, noPkgs ? styles.vehRowDisabled : null, pressed ? styles.pressedRow : null]}
                accessibilityRole="button"
                accessibilityState={{ selected: isOpen, disabled: noPkgs }}
              >
                <View style={styles.iconWrap}>
                  <VehicleIcon slug={cat.slug} size={34} />
                </View>

                <View style={styles.vehInfo}>
                  <Text style={styles.vehName} numberOfLines={1}>{cat.displayName}</Text>
                  <View style={styles.vehSeatsRow}>
                    <View style={styles.seatsWrap}>
                      <Feather name="user" size={13} color={h.muted} />
                      <Text style={styles.vehSeats}>{`${cat.maxPassengers} seats`}</Text>
                    </View>
                    {premium ? (
                      <View style={styles.premiumChip}>
                        <Feather name="star" size={11} color="#7A5410" />
                        <Text style={styles.premiumChipText}>Premium</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                <View style={styles.vehFareBlock}>
                  {noPkgs ? (
                    <Text style={styles.vehNoPkgs}>No packages</Text>
                  ) : pkgsLoading ? (
                    <Skeleton width={56} height={16} />
                  ) : isOpen && selectedPkg ? (
                    <Text style={styles.vehFare}>{formatRupees(selectedPkg.packageFare)}</Text>
                  ) : fromFare != null ? (
                    <>
                      <Text style={styles.vehFrom}>from</Text>
                      <Text style={styles.vehFare}>{formatRupees(fromFare)}</Text>
                    </>
                  ) : null}
                </View>
                <Feather
                  name={isOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={isOpen ? h.tealText : h.faint}
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
                      <View style={styles.trayHead}>
                        <Text style={styles.trayTitle}>Choose a package</Text>
                        <View style={styles.trayCount}>
                          <Text style={styles.trayCountText}>{`${pkgs.length} packages`}</Text>
                          <Feather name="chevron-right" size={14} color={h.faint} />
                        </View>
                      </View>
                      <PackageSlider
                        tiles={pkgs.map((p) => ({ id: p.id, hours: formatDuration(p.durationMinutes), km: `${p.kmLimit} km`, price: formatRupees(p.packageFare) }))}
                        selectedId={shownPkgId}
                        bestId={recommendation?.packageId ?? null}
                        onSelect={(id) => { setUserPickedPkg(true); setSelectedPkgId(id) }}
                      />

                      {selectedPkg ? (
                        <>
                          <View style={styles.incRow}>
                            <View style={styles.incCol}>
                              <Text style={styles.incLabel}>Included</Text>
                              <Text style={styles.incValue}>{`${selectedPkg.kmLimit} km · ${formatDuration(selectedPkg.durationMinutes)}`}</Text>
                            </View>
                            <View style={styles.incSep} />
                            <View style={styles.incCol}>
                              <Text style={styles.incLabel}>After that</Text>
                              <Text style={[styles.incValue, { color: h.tealText }]} numberOfLines={1}>{`${formatRupees(selectedPkg.extraPerKm)}/km · ${formatRupees(selectedPkg.extraPerMin)}/min`}</Text>
                            </View>
                          </View>
                          {estimate != null && estimate.surgeMultiplier > 1 ? (
                            <View style={styles.surgeRow}>
                              <Feather name="zap" size={11} color={h.goldInk} />
                              <Text style={styles.surgeText}>{`${estimate.surgeMultiplier}× surge applies to this fare`}</Text>
                            </View>
                          ) : null}
                          {trip ? (() => {
                            const o = estimateOverage(selectedPkg, trip.km, trip.min)
                            const lead = `Your trip is about ${trip.km} km and ${formatDuration(trip.min)}.`
                            const parts = [o.overKm > 0 ? `${o.overKm} km` : null, o.overMin > 0 ? `${formatDuration(o.overMin)}` : null].filter(Boolean).join(' and ')
                            const fits = o.extra === 0
                            return (
                              <View style={[styles.estBox, fits ? styles.estFit : styles.estOver]}>
                                <Feather name={fits ? 'check-circle' : 'alert-circle'} size={16} color={fits ? h.tealText : '#9A6A12'} style={styles.estIcon} />
                                <Text style={[styles.estText, { color: fits ? '#0A5666' : '#5A4310' }]}>
                                  {fits
                                    ? `${lead} It fits this package, so no extra charges are expected.`
                                    : `${lead} That is ${parts} over this package. Estimated extra ${formatRupees(o.extra)}, billed after the ride.`}
                                </Text>
                              </View>
                            )
                          })() : null}
                        </>
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
        {/* Loading / refused / failed checks keep their message line; an applied offer shows in the Offers button and the Book price. */}
        {openCatId !== null && ((couponState.kind === 'loading' && offersAvailable) || couponState.kind === 'rejected' || couponState.kind === 'error') ? <CouponLine state={couponState} onOpenSheet={() => setOfferSheetOpen(true)} onRemove={offers.removeCode} onRetry={offers.retry} /> : null}
        {/* Cash and Offers side by side. Offers is absent while offers are off, and shows the code once one applies. */}
        {openCatId !== null ? (
          <View style={styles.payRow}>
            <View style={styles.payBtn} accessible accessibilityLabel="Payment method: Cash">
              <Feather name="credit-card" size={18} color={h.ivory} />
              <Text style={styles.payText}>Cash</Text>
              <Feather name="chevron-down" size={14} color={h.faint} style={styles.payChev} />
            </View>
            {offersAvailable ? (
              <Pressable
                onPress={() => setOfferSheetOpen(true)}
                style={({ pressed }) => [styles.payBtn, shownApplied ? styles.payBtnOn : null, pressed ? styles.pressedScale : null]}
                accessibilityRole="button"
                accessibilityLabel={shownApplied ? `Offer ${offerLabel} applied. Change offer` : 'Offers. Have a code? Add an offer code'}
              >
                <Feather name="tag" size={18} color={h.tealText} />
                <Text style={[styles.payText, shownApplied ? styles.payTextOn : null]} numberOfLines={1}>{offerLabel}</Text>
                <Feather name="chevron-right" size={14} color={h.faint} style={styles.payChev} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
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
              : estimate != null && estimateKey === `${openCatId}:${selectedPkgId}`
              ? `Book ${openCategoryName} · ${formatRupees(payable ?? estimate.breakdown.total)}`
              : `Book ${openCategoryName}`
          }
          {...(appliedOffer && estimate != null && selectedFare != null && payable != null && payable < selectedFare ? { strikeLabel: formatRupees(selectedFare) } : {})}
          onPress={() => void handleBook()}
          disabled={!canBook}
          keepLookWhenDisabled={!!drop && openCatId !== null && !booking && (estLoading || selectedPkgId === null || offers.bookLocked)}
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
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 6 },
  pressedScale: { transform: [{ scale: 0.97 }] },
  pressedRow: { transform: [{ scale: 0.985 }] },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.b, fontSize: 20, letterSpacing: -0.2, color: h.ivory },
  subtitle: { fontFamily: font.m, fontSize: 13, color: h.muted, marginTop: 1 },
  riderPill: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 36, paddingLeft: 12, paddingRight: 14, borderRadius: 18, backgroundColor: h.chip, borderWidth: 1, borderColor: h.line06, maxWidth: 130 },
  riderPillText: { fontSize: 13.5, color: h.ivory, fontFamily: font.b, flexShrink: 1 },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24 },

  tripCard: { backgroundColor: h.surface, borderWidth: 1, borderColor: h.line07, borderRadius: 22, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 8, boxShadow: '0 2px 8px rgba(20,23,26,0.05), inset 0 1px 0 rgba(255,255,255,0.9)' },
  tripRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  tripMeta: { fontSize: 13.5, color: h.muted, fontFamily: font.sb, fontVariant: ['tabular-nums'] },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  routeText: { fontSize: 14, color: h.ivory, fontFamily: font.sb, flex: 1 },
  pickupDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: h.teal, boxShadow: '0 0 0 3px rgba(14,143,163,0.16)' },
  dropDot: { width: 9, height: 9, borderRadius: 2.5, backgroundColor: h.ivory },
  scheduleChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingLeft: 10, paddingRight: 12, borderRadius: 16, backgroundColor: h.tealWash },
  scheduleChipText: { fontSize: 13, color: h.tealText, fontFamily: font.b },

  vehHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 24, marginBottom: 12, marginHorizontal: 2 },
  sectionLabel: { ...sectionLabel },
  vehCount: { fontSize: 12.5, color: h.label, fontFamily: font.m },

  vehCard: { backgroundColor: h.surface, borderWidth: 1, borderColor: h.line08, borderRadius: 20, marginBottom: 10, overflow: 'hidden', boxShadow: '0 2px 8px rgba(20,23,26,0.05)' },
  vehCardOpen: { borderWidth: 1.5, borderColor: h.tealCta, borderRadius: 22, boxShadow: '0 0 0 4px rgba(14,143,163,0.09), 0 2px 8px rgba(20,23,26,0.06)' },
  vehRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingLeft: 12, paddingRight: 14 },
  vehRowDisabled: { opacity: 0.4 },
  iconWrap: { width: 68, height: 52, borderRadius: 14, backgroundColor: '#F4F5F1', alignItems: 'center', justifyContent: 'center' },
  vehInfo: { flex: 1, minWidth: 0 },
  vehName: { fontSize: 16, fontFamily: font.b, color: h.ivory },
  // wraps so the Premium chip drops under the seat count on a narrow phone instead of running under the price
  vehSeatsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 4, marginTop: 5 },
  seatsWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  vehSeats: { fontFamily: font.sb, fontSize: 12.5, color: h.muted },
  premiumChip: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: '#FBF1D9' },
  premiumChipText: { fontFamily: font.b, fontSize: 12, color: '#7A5410' },
  vehFareBlock: { width: 62, alignItems: 'flex-end', justifyContent: 'center' },
  vehFrom: { fontSize: 12, fontFamily: font.m, color: h.label },
  vehFare: { fontSize: 17, fontFamily: font.xb, letterSpacing: -0.2, color: h.ivory, fontVariant: ['tabular-nums'] },
  vehNoPkgs: { fontSize: 12, fontFamily: font.sb, color: h.faint },

  tray: { borderTopWidth: 1, borderTopColor: h.line07, marginHorizontal: 16, paddingTop: 14, paddingBottom: 18 },
  trayLoadingRow: { flexDirection: 'row', gap: 10, paddingTop: 8 },
  trayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  trayTitle: { fontFamily: font.sb, fontSize: 14, color: h.ivory },
  trayCount: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  trayCountText: { fontFamily: font.m, fontSize: 12.5, color: h.label },
  incRow: { flexDirection: 'row', marginTop: 12, paddingTop: 14, borderTopWidth: 1, borderTopColor: h.line07 },
  incCol: { flex: 1, minWidth: 0 },
  incSep: { width: 1, backgroundColor: h.line08, marginHorizontal: 16 },
  incLabel: { fontFamily: font.m, fontSize: 12.5, color: h.label, marginBottom: 3 },
  incValue: { fontFamily: font.b, fontSize: 14.5, color: h.ivory, fontVariant: ['tabular-nums'] },
  surgeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12 },
  surgeText: { fontSize: 12.5, fontFamily: font.sb, color: h.goldInk },
  estBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 14, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14 },
  estFit: { backgroundColor: h.tealWash },
  estOver: { backgroundColor: '#FBF3E1' },
  estIcon: { marginTop: 1 },
  estText: { flex: 1, fontFamily: font.m, fontSize: 13, lineHeight: 19 },

  footnote: { fontFamily: font.m, fontSize: 12.5, lineHeight: 18, color: h.faint, marginTop: 4 },
  footnoteStrong: { color: h.muted, fontFamily: font.sb },

  footer: { paddingHorizontal: 18, paddingTop: 14, backgroundColor: h.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, boxShadow: '0 -10px 30px rgba(20,23,26,0.08)' },
  payRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  payBtn: { flex: 1, height: 46, borderRadius: 16, backgroundColor: h.chip, borderWidth: 1, borderColor: h.line06, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  payBtnOn: { backgroundColor: '#E3F3F6', borderColor: 'rgba(14,143,163,0.4)' },
  payText: { fontFamily: font.sb, fontSize: 14, color: h.ivory, flexShrink: 1 },
  payTextOn: { fontFamily: font.b, color: h.tealText },
  payChev: { marginLeft: 'auto' },
  error: { fontFamily: font.r, fontSize: 14.5, lineHeight: 21, color: h.danger, marginBottom: 4, textAlign: 'center' },
})
