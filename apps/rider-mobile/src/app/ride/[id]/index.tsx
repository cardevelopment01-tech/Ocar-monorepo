import { useEffect, useRef, useState } from 'react'
import { Alert, Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Button, ErrorState, SOSButton, Skeleton, TripClock, useTripWindow, font, h, shadow, spacing, getApiErrorMessage, getFreshFix, getLastKnownFix, track } from '@ocar/mobile-shared'
import { api, serverNow } from '@/services/api'
import { triggerSos } from '@/features/safety/api'
import { useLocationStore } from '@/store/useLocationStore'
import { useLiveLocation } from '@/features/home/useLiveLocation'
import { SearchingBar } from '@/features/ride-tracking/components/SearchingBar'
import { TripDetailsRow } from '@/features/ride-tracking/components/TripDetailsRow'
import { DriverCard } from '@/features/ride-tracking/components/DriverCard'
import { MeetAtRow, PinBand } from '@/features/ride-tracking/components/DriverIdentity'
import { RideMapView } from '@/features/ride-tracking/components/RideMapView'
import { StatusBanner } from '@/features/ride-tracking/components/StatusBanner'
import { CancelSheet } from '@/features/ride-tracking/components/CancelSheet'
import { AddStopSheet } from '@/features/ride-tracking/components/AddStopSheet'
import { EditPickupSheet } from '@/features/ride-tracking/components/EditPickupSheet'
import { StopTimeline } from '@/features/ride-tracking/components/StopTimeline'
import { NextStopRow } from '@/features/ride-tracking/components/NextStopRow'
import { TripDetailsCard } from '@/features/ride-tracking/components/TripDetailsCard'
import { FareDriftToast, UpgradeToast } from '@/features/ride-tracking/components/Toasts'
import { goBack } from '@/lib/goBack'
import { IconButton } from '@/components/ui'
import { TripSummary } from '@/features/trip-summary/TripSummary'
import { ReconnectBanner } from '@/features/ride-tracking/components/ReconnectBanner'
import { DriverCancelledBanner } from '@/features/ride-tracking/components/DriverCancelledBanner'
import { useRideTracking } from '@/features/ride-tracking/useRideTracking'
import { cancelRide, addStop, skipStop, updatePickup, type StopInput } from '@/features/ride-tracking/api'
import { ASSIGNED_STATUSES, IN_PROGRESS_STATUSES, SEARCHING_STATUSES } from '@/features/ride-tracking/types'
import { useNearbyDrivers } from '@/features/booking/useNearbyDrivers'
import { useVehicleKinds } from '@/features/booking/useVehicleKinds'
import { showWithinMetres } from '@/features/booking/liveCars'
import type { StatusKey } from '@/features/ride-tracking/statusConfig'
import { resolveBookingError } from '@/features/booking/api'
import { PickupUpdatedToast } from '@/features/ride-tracking/components/Toasts'
import { canShareRide } from '@/features/trip-share/model'
import { useTripShare } from '@/features/trip-share/useTripShare'
import { ShareTripSheet } from '@/features/trip-share/components/ShareTripSheet'
import { ManageSharesSheet, confirmStopAll } from '@/features/trip-share/components/ManageSharesSheet'
import { SharingBanner } from '@/features/trip-share/components/SharingBanner'

// Mirrors api/src/modules/rides/rides.service.ts's PICKUP_EDITABLE_STATUSES --
// once the driver has arrived, "where do I pick you up" no longer applies.
const PICKUP_EDITABLE_STATUSES = new Set(['requested', 'accepted'])

const STALE_LOCATION_MS = 3 * 60 * 1000
// Caps the docked sheet so the map always stays the dominant element, even
// with "Trip details" expanded -- matches Uber's own half-screen sheet
// ceiling (its Base design system caps a mobile sheet at collapsed/half/full,
// never letting the half state swallow the whole map).
const MAX_SHEET_HEIGHT_RATIO = 0.7
const SHEET_ENTRANCE_DISTANCE = 40
const SHEET_ENTRANCE_DURATION_MS = 400

// Booked-time clock for hourly round trips, in rider wording and on the server clock. Null copy = no
// window (one-way, rental, legacy pricing), so those rides show nothing. It lives in its own component
// because the hook ticks every second in grace/overtime; in the screen that re-rendered the map, driver
// card and sheet every second.
function RideTripClock({ ride }: { ride: NonNullable<ReturnType<typeof useRideTracking>['ride']> }) {
  const tripClock = useTripWindow(ride, { now: serverNow, audience: 'rider' })
  return tripClock.copy ? <TripClock copy={tripClock.copy} stateKey={tripClock.state.kind} /> : null
}

export default function RideTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const rideId = id ?? ''
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const {
    ride, loading, loadError, socketConnected, driverCancelled, lastLocationAt,
    driverPos, driverHeading, driverHeadingKnown, pickup, drop, routePoints, eta, driverLocated, unreadChatCount,
    fareDrift, dismissFareDrift, upgradeCategory, retry,
  } = useRideTracking(rideId)
  const canShare = ride ? canShareRide(ride) : false
  const tripShare = useTripShare(rideId, canShare)

  // While a ride is being matched ('requested' only: a scheduled ride is not matched yet) show the available cars around
  // the pickup, like the fare screen does, so the rider sees that drivers are close. They go away once a driver is assigned.
  const { kinds: vehicleKinds, slugs: vehicleSlugs } = useVehicleKinds()
  const bookedCategoryId = ride?.categoryId != null && Number.isFinite(Number(ride.categoryId)) ? Number(ride.categoryId) : null
  const nearbyCars = useNearbyDrivers(
    ride ? rideId : null, ride?.originLat ?? null, ride?.originLng ?? null, ride?.status === 'requested',
    showWithinMetres(ride?.rideType, bookedCategoryId === null ? null : vehicleSlugs.get(bookedCategoryId)), bookedCategoryId,
  )

  // "Driver's location hasn't updated" must appear when updates STOP, so it needs a timer: a memo on
  // lastLocationAt only recomputed when a new update arrived, i.e. exactly when it was never true.
  const [stale, setStale] = useState(false)
  useEffect(() => {
    if (lastLocationAt == null) { setStale(false); return }
    const remaining = lastLocationAt + STALE_LOCATION_MS - Date.now()
    if (remaining <= 0) { setStale(true); return }
    setStale(false)
    const t = setTimeout(() => setStale(true), remaining)
    return () => clearTimeout(t)
  }, [lastLocationAt])

  const storeLat = useLocationStore((s) => s.lat)
  const storeLng = useLocationStore((s) => s.lng)
  const locationGranted = useLocationStore((s) => s.permission === 'granted')
  // The rider's own position is only needed by "Edit pickup" (distance to the pin) and SOS, so no
  // GPS/compass watch runs for the whole trip: the watcher starts only while the edit sheet is open
  // (no compass), and SOS takes a one-off fix when it fires. A continuous watch plus a compass
  // subscription re-rendered this entire screen on every heading change for hours.

  const cancelInFlightRef = useRef(false)
  const [cancelling, setCancelling] = useState(false)
  const [showCancelSheet, setShowCancelSheet] = useState(false)
  const [addStopOpen, setAddStopOpen] = useState(false)
  // Live trip sharing: the links for this trip. Called here (before any early return) so the hook order never changes.
  const [shareOpen, setShareOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [addStopError, setAddStopError] = useState<string | null>(null)
  const [editPickupOpen, setEditPickupOpen] = useState(false)
  const live = useLiveLocation(locationGranted && editPickupOpen, { heading: false }).coords
  const [pickupUpdating, setPickupUpdating] = useState(false)
  const [pickupError, setPickupError] = useState<string | null>(null)
  const [pickupToast, setPickupToast] = useState(false)
  // Collapsed by default, as in the approved design: the sheet stays calm and the details open in place from one row.
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  // Height of the docked sheet, so the map frames the trip (and the car) above it, not underneath.
  const [sheetHeight, setSheetHeight] = useState(0)
  // Opening "Trip details" adds content below the fold of the sheet; scroll it into view or the tap looks like it did
  // nothing. Details start open, so skip the first run and only react to a later open.
  const sheetScrollRef = useRef<ScrollView>(null)
  const detailsMounted = useRef(false)
  useEffect(() => {
    if (!detailsMounted.current) { detailsMounted.current = true; return }
    if (!detailsExpanded) return
    const t = setTimeout(() => sheetScrollRef.current?.scrollToEnd({ animated: true }), 80)
    return () => clearTimeout(t)
  }, [detailsExpanded])
  // Stops whose "driver can't reach this" prompt the rider chose to keep; the timeline Skip still works.
  const [keptStops, setKeptStops] = useState<number[]>([])
  const [skippingStop, setSkippingStop] = useState(false)

  // Sheet entrance: a plain fade + 40px rise (not a spring) -- same treatment
  // as driver-mobile's RideSheet, so every docked bottom sheet in the app
  // reads as one consistent system instead of each screen inventing its own.
  const entrance = useSharedValue(0)
  useEffect(() => {
    entrance.set(withTiming(1, { duration: SHEET_ENTRANCE_DURATION_MS, easing: Easing.out(Easing.cubic) }))
  }, [entrance])
  const sheetEntranceStyle = useAnimatedStyle(() => ({
    opacity: entrance.get(),
    transform: [{ translateY: (1 - entrance.get()) * SHEET_ENTRANCE_DISTANCE }],
  }))

  // One tap must not throw away a search that may be seconds from matching, so ask first.
  function confirmCancelSearch() {
    Alert.alert('Cancel this request?', "We'll stop looking for a driver. You can book again any time.", [
      { text: 'Keep waiting', style: 'cancel' },
      { text: 'Cancel request', style: 'destructive', onPress: () => void cancelSearch() },
    ])
  }

  async function cancelSearch() {
    if (cancelInFlightRef.current) return
    cancelInFlightRef.current = true
    setCancelling(true)
    try {
      await api.post(`/api/v1/rides/${rideId}/cancel`, { reasonCode: 'rider_cancelled_searching' })
      track('ride_cancelled', { reason: 'rider_cancelled_searching' })
      router.replace('/(tabs)/home')
    } catch {
      setCancelling(false)
    } finally {
      cancelInFlightRef.current = false
    }
  }

  async function handleCancelConfirm(reasonCode: string, reason?: string) {
    // A failure throws to the sheet, which stays open and shows the error.
    await cancelRide(rideId, reasonCode, reason)
    setShowCancelSheet(false)
    router.replace('/(tabs)/home')
  }

  async function handleAddStop(stop: StopInput) {
    setAddStopOpen(false)
    try {
      await addStop(rideId, stop)
      setAddStopError(null)
      // Auto-open "Trip details" so the new stop is immediately visible in
      // the timeline -- previously a rider could add a stop and see nothing
      // change anywhere unless they thought to tap the (collapsed) toggle.
      setDetailsExpanded(true)
      retry()
    } catch (err) {
      setAddStopError(getApiErrorMessage(err, "Couldn't add that stop. Please try again."))
      setTimeout(() => setAddStopError(null), 5000)
    }
  }

  // Every skip (the timeline, the next-stop row, or the answer to "driver can't reach this") goes
  // through here, so the busy flag blocks a double tap and a failure surfaces the same way.
  function runSkip(sequence: number) {
    if (skippingStop) return
    setSkippingStop(true)
    skipStop(rideId, sequence)
      .then(retry)
      .catch((err) => {
        setAddStopError(getApiErrorMessage(err, "Couldn't skip that stop. Please try again."))
        setTimeout(() => setAddStopError(null), 5000)
      })
      .finally(() => setSkippingStop(false))
  }

  function handleSkipStop(stop: { sequence: number; address?: string | null }) {
    Alert.alert('Skip this stop?', `${stop.address ?? `Stop ${stop.sequence}`} will be removed from your trip. Any stop charge already added to your fare stays.`, [
      { text: 'Keep stop', style: 'cancel' },
      { text: 'Skip stop', style: 'destructive', onPress: () => runSkip(stop.sequence) },
    ])
  }

  async function handleUpdatePickup(pickup: { lat: number; lng: number; address: string | null }) {
    setPickupUpdating(true)
    setPickupError(null)
    try {
      await updatePickup(rideId, pickup)
      setEditPickupOpen(false)
      setPickupToast(true)
      setTimeout(() => setPickupToast(false), 2600)
      retry()
    } catch (err) {
      setPickupError(resolveBookingError(err))
    } finally {
      setPickupUpdating(false)
    }
  }

  // The drive to pickup has no booked distance, so the bar's total is the first distance the ETA reported.
  const [startKm, setStartKm] = useState<number | null>(null)
  useEffect(() => {
    if (ride?.status === 'accepted' && eta && startKm === null && eta.distanceKm > 0) setStartKm(eta.distanceKm)
  }, [ride?.status, eta, startKm])

  if (driverCancelled) {
    return <DriverCancelledBanner />
  }

  if (loading && !ride) {
    return (
      <View style={styles.container}>
        <Skeleton height={100} style={styles.skeletonBlock} />
        <Skeleton height={72} style={styles.skeletonBlock} />
      </View>
    )
  }

  if (loadError && !ride) {
    return (
      <View style={styles.container}>
        <ErrorState message="Couldn't load this ride" onRetry={retry} />
      </View>
    )
  }

  if (!ride) return null

  const isSearching = SEARCHING_STATUSES.has(ride.status)
  const isAssigned = ASSIGNED_STATUSES.has(ride.status)
  const isInProgress = IN_PROGRESS_STATUSES.has(ride.status)
  const isCompleted = ride.status === 'completed'
  const isCancelled = ride.status === 'cancelled' || ride.status === 'no_drivers'
  const hasDriver = ride.driverId != null && (isAssigned || isInProgress)
  const status = (ride.status as StatusKey)
  // 'returning' = a round trip's return leg: calling, adding and skipping stops all stay available on it.
  const canCall = ride.status === 'accepted' || ride.status === 'driver_arrived' || ride.status === 'in_progress' || ride.status === 'returning'
  const canAddStop = canCall
  // Mirrors api skipRideStop: the driver can no longer skip, so the rider owns it until the drop is reached.
  const canSkipStop = canAddStop && !ride.dropArrivedAt
  const unreachableStop = canSkipStop
    ? ride.stops.find((s) => s.status === 'pending' && s.unreachableRequestedAt && !keptStops.includes(s.sequence))
    : undefined
  const pendingStops = ride.stops.filter((s) => s.status === 'pending')
  const nextStop = canSkipStop ? pendingStops[0] : undefined
  const canCancel = ride.status === 'accepted' || ride.status === 'driver_arrived'
  const canEditPickup = PICKUP_EDITABLE_STATUSES.has(ride.status)
  const fare = ride.totalFinal != null
    ? `₹${Math.round(parseFloat(ride.totalFinal))}`
    : ride.totalEstimated != null ? `₹${Math.round(parseFloat(ride.totalEstimated))}` : null

  // A finished trip is a receipt, not a live map: full-screen summary, shared with My Trips.
  if (isCompleted || isCancelled) return <TripSummary ride={ride} onRefresh={retry} />

  return (
    <View style={styles.screen}>
      {/* Full-bleed map behind everything -- the map is the dominant surface,
          matching Uber/Rapido/Ola's actual layout (a boxed 340px map header
          above a scrolling stack of cards, the previous shape here, reads as
          a form, not a live trip). Sheet below docks over it. */}
      <RideMapView
        pickup={pickup}
        drop={drop}
        driverPos={hasDriver ? driverPos : null}
        driverHeading={driverHeading}
        driverHeadingKnown={driverHeadingKnown}
        routePoints={routePoints}
        showDrop={drop != null}
        stops={ride.stops.filter((s) => s.status === 'pending').map((s): [number, number] => [s.lat, s.lng])}
        coveredBottom={sheetHeight}
        nearbyDrivers={nearbyCars}
        driverLocated={driverLocated}
        frameDrop={!isAssigned}
        sheetPending={sheetHeight === 0}
        vehicleKinds={vehicleKinds}
        driverKind={(bookedCategoryId === null ? undefined : vehicleKinds.get(bookedCategoryId)) ?? 'sedan'}
      />

      <View style={[styles.mapOverlayTop, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        {isAssigned ? <View style={styles.backRow}><IconButton icon="arrow-left" label="Back" onPress={() => goBack(router)} /></View> : null}
        {isInProgress ? (
          <View style={styles.tripPill}>
            <View style={styles.tripPillDot} />
            <Text style={styles.tripPillText}>{ride.status === 'returning' ? 'Returning to pickup' : 'Trip in progress'}</Text>
          </View>
        ) : null}
        {!socketConnected ? <ReconnectBanner /> : null}
        {addStopError ? <Text style={styles.addStopError}>{addStopError}</Text> : null}
      </View>

      <SOSButton
        enabled
        onTrigger={async () => {
          // SOS must not wait on GPS: take a fresh fix only if it lands within 1.5s, else the OS
          // last-known one, else the saved one (a rough location beats none).
          const fresh = await Promise.race([
            getFreshFix().catch(() => null),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
          ])
          const fix = fresh ?? (await getLastKnownFix())
          return triggerSos(rideId, fix?.lat ?? storeLat ?? undefined, fix?.lng ?? storeLng ?? undefined)
        }}
        anchor="top-right"
        look="redesign"
        {...(canShare ? { onShareTrip: () => setShareOpen(true) } : {})}
      />

      <Animated.View
        style={[styles.sheet, sheetEntranceStyle]}
        onLayout={(e) => {
          const height = Math.round(e.nativeEvent.layout.height)
          setSheetHeight((prev) => (Math.abs(prev - height) >= 4 ? height : prev))
        }}
      >
        <Pressable onPress={() => hasDriver && setDetailsExpanded((v) => !v)} accessibilityRole="button" accessibilityLabel="Expand trip details" style={styles.handleHit}>
          <View style={styles.handle} />
        </Pressable>
        <ScrollView
          ref={sheetScrollRef}
          style={styles.sheetScroll}
          contentContainerStyle={[styles.sheetContent, { paddingBottom: Math.max(insets.bottom, spacing.lg) + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {upgradeCategory ? <UpgradeToast categoryName={upgradeCategory} /> : null}
          {pickupToast ? <PickupUpdatedToast driverNotified={!!ride.driverId} /> : null}
          {fareDrift ? (
            <FareDriftToast previousFare={fareDrift.previousFare} currentFare={fareDrift.currentFare} onDismiss={dismissFareDrift} />
          ) : null}

          <StatusBanner status={status} eta={eta} totalKm={status === 'accepted' ? startKm : (ride.estimatedKm ?? null)}
            {...(status === 'driver_arrived' && ride.startOtp ? { pin: ride.startOtp } : {})} {...(status === 'accepted' && !driverLocated ? { overrideSub: 'Locating your driver…' } : {})} />

          {unreachableStop ? (
            <View style={styles.unreachableBanner} accessibilityRole="alert">
              <Text style={styles.unreachableTitle}>Your driver can't reach a stop</Text>
              <Text style={styles.unreachableBody}>
                {unreachableStop.address ?? `Stop ${unreachableStop.sequence}`}. Skip it, or keep it and your driver will continue to it.
              </Text>
              <View style={styles.unreachableActions}>
                <Button
                  variant="cta"
                  label="Skip stop"
                  loading={skippingStop}
                  onPress={() => runSkip(unreachableStop.sequence)}
                />
                <Button
                  label="Keep stop"
                  variant="soft"
                  disabled={skippingStop}
                  onPress={() => setKeptStops((k) => [...k, unreachableStop.sequence])}
                />
              </View>
            </View>
          ) : null}

          {isInProgress ? <RideTripClock ride={ride} /> : null}

          {isSearching ? (
            <View style={styles.searchingBlock}>
              <SearchingBar />
              <Text style={styles.searchingBody}>
                {ride.status === 'scheduled'
                  ? "Your pickup is scheduled. We'll start matching you with a nearby driver shortly before it."
                  : "Hang tight, we're matching you with a nearby driver."}
              </Text>
              <Pressable
                onPress={confirmCancelSearch}
                disabled={cancelling}
                accessibilityRole="button"
                accessibilityLabel="Cancel this ride request"
                style={styles.cancelButton}
              >
                <Text style={styles.cancelButtonText}>{cancelling ? 'Cancelling…' : 'Cancel request'}</Text>
              </Pressable>
              <Pressable
                onPress={() => setEditPickupOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Edit pickup location"
                style={styles.editPickupLink}
              >
                <Text style={styles.editPickupLinkText}>Edit pickup</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Same order as Uber/Rapido: where to meet, the PIN to read out, then who is coming.
              The start OTP doesn't exist server-side until the driver hits 'driver_arrived'
              (rides.service.ts's markArrived generates it) -- showing the band during plain
              'accepted' left it stuck on "Generating..." for the whole en-route leg. */}
          {hasDriver && isAssigned ? (
            <MeetAtRow address={ride.originAddress} lat={ride.originLat} lng={ride.originLng} />
          ) : null}
          {/* The end PIN is only released once the driver taps "Arrived at drop", so it is not on screen all trip. */}
          {hasDriver && isInProgress && ride.dropArrivedAt ? <PinBand otp={ride.endOtp ?? null} phase="end" /> : null}
          {hasDriver ? (
            <DriverCard
              ride={ride}
              stale={stale}
              rideId={rideId}
              canCall={canCall}
              unreadChatCount={unreadChatCount}
              onOpenChat={() => router.push(`/ride/${rideId}/chat`)}
            />
          ) : null}

          {/* Ride actions as an icon-over-label strip (Uber's Share / Safety / Cancel row). Trip details (address
              + fare) stays collapsed by default -- Rapido's trip-detail expand -- so the fare isn't permanently
              in front of the rider; Cancel keeps its red, deliberate placement at the end of the row. */}
          {hasDriver && nextStop && unreachableStop?.sequence !== nextStop.sequence ? (
            <NextStopRow
              stop={nextStop}
              position={ride.stops.findIndex((s) => s.id === nextStop.id) + 1}
              total={ride.stops.length}
              busy={skippingStop}
              onSkip={handleSkipStop}
            />
          ) : null}
          {canShare ? <SharingBanner count={tripShare.shares.length} onManage={() => setManageOpen(true)} onStop={() => confirmStopAll(() => { void tripShare.stopAll().then((ok) => { if (!ok) Alert.alert('Could not stop sharing', 'Check your connection and try again. Your links are still active.') }) }, tripShare.shares.some((s) => s.isSos))} /> : null}
          {hasDriver ? (
            <TripDetailsRow
              open={detailsExpanded}
              onToggle={() => setDetailsExpanded((v) => !v)}
              hint={[canAddStop ? 'Add stop' : null, canCancel ? 'cancel' : null, !canAddStop && !canCancel ? 'Route and fare' : null].filter(Boolean).join(', ')}
              actions={[
                ...(canAddStop ? [{ key: 'stop', label: 'Add stop', icon: 'plus-circle' as const, onPress: () => setAddStopOpen(true) }] : []),
                ...(canShare ? [{ key: 'share', label: 'Share live trip', icon: 'share' as const, onPress: () => setShareOpen(true) }] : []),
                ...(canEditPickup ? [{ key: 'pickup', label: 'Edit pickup', icon: 'map-pin' as const, onPress: () => setEditPickupOpen(true) }] : []),
              ]}
              cancel={canCancel ? {
                note: ride.status === 'driver_arrived'
                  ? 'Your driver has arrived, so a small cancellation fee may apply.'
                  : 'No fee before your driver arrives. A small fee may apply after.',
                onPress: () => setShowCancelSheet(true),
              } : null}
            >
              <TripDetailsCard ride={ride} fare={fare} />
              {ride.stops.length > 0 ? <StopTimeline stops={ride.stops} {...(canSkipStop ? { onSkip: handleSkipStop } : {})} /> : null}
            </TripDetailsRow>
          ) : null}

        </ScrollView>
      </Animated.View>

      <ShareTripSheet visible={shareOpen} onClose={() => setShareOpen(false)} share={tripShare} />
      <ManageSharesSheet visible={manageOpen} onClose={() => setManageOpen(false)} share={tripShare} />
      <CancelSheet
        visible={showCancelSheet}
        feeWarning={ride.status === 'driver_arrived'}
        onClose={() => setShowCancelSheet(false)}
        onConfirm={handleCancelConfirm}
      />
      <AddStopSheet
        visible={addStopOpen}
        originLat={ride.originLat}
        originLng={ride.originLng}
        onClose={() => setAddStopOpen(false)}
        onSelect={handleAddStop}
      />
      <EditPickupSheet
        visible={editPickupOpen}
        originLat={ride.originLat}
        originLng={ride.originLng}
        originAddress={ride.originAddress}
        userPos={live ? [live.lat, live.lng] : null} // live-only: a saved fix would draw a stale rider marker and distance
        driverAssigned={ride.driverId != null}
        confirming={pickupUpdating}
        error={pickupError}
        onClose={() => setEditPickupOpen(false)}
        onConfirm={handleUpdatePickup}
      />
    </View>
  )
}

const SCREEN_HEIGHT = Dimensions.get('window').height

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: h.canvas },
  container: { flex: 1, backgroundColor: h.canvas },
  skeletonBlock: { marginBottom: spacing.md },
  mapOverlayTop: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: spacing.md, gap: spacing.xs, zIndex: 5 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: SCREEN_HEIGHT * MAX_SHEET_HEIGHT_RATIO,
    backgroundColor: h.surface,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    boxShadow: '0 -12px 32px rgba(20,23,26,0.12)',
  },
  handleHit: { height: 28, justifyContent: 'center' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.14)', alignSelf: 'center' },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { paddingHorizontal: 18, paddingTop: 4, gap: 14 },
  searchingBlock: { gap: 12, alignItems: 'center', paddingVertical: 4 },
  searchingBody: { fontFamily: font.m, fontSize: 14, lineHeight: 21, color: h.muted, textAlign: 'center' },
  cancelButton: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', minHeight: 52, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(194,59,59,0.28)' },
  cancelButtonText: { fontFamily: font.b, fontSize: 15, color: h.danger },
  editPickupLink: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  editPickupLinkText: { fontFamily: font.b, fontSize: 13.5, color: h.tealText },
  unreachableBanner: { gap: 6, backgroundColor: h.goldWash, borderRadius: 18, padding: 16 },
  unreachableTitle: { fontFamily: font.b, fontSize: 14.5, color: h.ivory },
  unreachableBody: { fontFamily: font.m, fontSize: 13.5, lineHeight: 20, color: h.muted },
  unreachableActions: { gap: 8, marginTop: 6 },
  backRow: { alignSelf: 'flex-start' },
  tripPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 9, height: 44, paddingLeft: 14, paddingRight: 16, borderRadius: 22, backgroundColor: h.surface, boxShadow: '0 4px 14px rgba(20,23,26,0.14)' },
  tripPillDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#1FA971', boxShadow: '0 0 0 4px rgba(31,169,113,0.18)' },
  tripPillText: { fontFamily: font.b, fontSize: 14, color: h.ivory },
  addStopError: { fontFamily: font.m, fontSize: 12.5, color: h.danger, alignSelf: 'flex-end', backgroundColor: h.surface, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, boxShadow: shadow.sm },
})
