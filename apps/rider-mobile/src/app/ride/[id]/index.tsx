import { useEffect, useMemo, useRef, useState } from 'react'
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ErrorState, SOSButton, Skeleton, colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { triggerSos } from '@/features/safety/api'
import { useLocationStore } from '@/store/useLocationStore'
import { DriverCard } from '@/features/ride-tracking/components/DriverCard'
import { RideMapView } from '@/features/ride-tracking/components/RideMapView'
import { StatusBanner } from '@/features/ride-tracking/components/StatusBanner'
import { CancelSheet } from '@/features/ride-tracking/components/CancelSheet'
import { AddStopSheet } from '@/features/ride-tracking/components/AddStopSheet'
import { StopTimeline } from '@/features/ride-tracking/components/StopTimeline'
import { TripDetailsCard } from '@/features/ride-tracking/components/TripDetailsCard'
import { FareDriftToast, UpgradeToast } from '@/features/ride-tracking/components/Toasts'
import { CashCollectionBanner } from '@/features/ride-tracking/components/CashCollectionBanner'
import { ReconnectBanner } from '@/features/ride-tracking/components/ReconnectBanner'
import { DriverCancelledBanner } from '@/features/ride-tracking/components/DriverCancelledBanner'
import { useRideTracking } from '@/features/ride-tracking/useRideTracking'
import { cancelRide, addStop, type StopInput } from '@/features/ride-tracking/api'
import { ASSIGNED_STATUSES, IN_PROGRESS_STATUSES, SEARCHING_STATUSES } from '@/features/ride-tracking/types'
import type { StatusKey } from '@/features/ride-tracking/statusConfig'

const STALE_LOCATION_MS = 3 * 60 * 1000
// Caps the docked sheet so the map always stays the dominant element, even
// with "Trip details" expanded -- matches Uber's own half-screen sheet
// ceiling (its Base design system caps a mobile sheet at collapsed/half/full,
// never letting the half state swallow the whole map).
const MAX_SHEET_HEIGHT_RATIO = 0.62
const SHEET_ENTRANCE_DISTANCE = 40
const SHEET_ENTRANCE_DURATION_MS = 400

export default function RideTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const rideId = id ?? ''
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const {
    ride, loading, loadError, socketConnected, driverCancelled, lastLocationAt,
    driverPos, driverHeading, driverHeadingKnown, pickup, drop, routePoints, eta, unreadChatCount,
    fareDrift, dismissFareDrift, upgradeCategory, retry,
  } = useRideTracking(rideId)

  const stale = useMemo(
    () => lastLocationAt != null && Date.now() - lastLocationAt > STALE_LOCATION_MS,
    [lastLocationAt]
  )

  const riderLat = useLocationStore((s) => s.lat)
  const riderLng = useLocationStore((s) => s.lng)

  const cancelInFlightRef = useRef(false)
  const [cancelling, setCancelling] = useState(false)
  const [showCancelSheet, setShowCancelSheet] = useState(false)
  const [addStopOpen, setAddStopOpen] = useState(false)
  const [addStopError, setAddStopError] = useState<string | null>(null)
  const [detailsExpanded, setDetailsExpanded] = useState(false)

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

  async function cancelSearch() {
    if (cancelInFlightRef.current) return
    cancelInFlightRef.current = true
    setCancelling(true)
    try {
      await api.post(`/api/v1/rides/${rideId}/cancel`, { reasonCode: 'rider_cancelled_searching' })
      router.replace('/(tabs)/home')
    } catch {
      setCancelling(false)
    } finally {
      cancelInFlightRef.current = false
    }
  }

  async function handleCancelConfirm(reasonCode: string, reason?: string) {
    try {
      await cancelRide(rideId, reasonCode, reason)
      setShowCancelSheet(false)
      router.replace('/(tabs)/home')
    } catch {
      setShowCancelSheet(false)
    }
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
    } catch {
      setAddStopError("Couldn't add that stop. Please try again.")
      setTimeout(() => setAddStopError(null), 5000)
    }
  }

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
  const needsCashCollection = isCompleted && (ride.paymentChannel ?? 'cash') === 'cash' && !ride.cashCollectedAt
  const hasDriver = ride.driverId != null && (isAssigned || isInProgress || isCompleted)
  const status = (ride.status as StatusKey)
  const canCall = ride.status === 'accepted' || ride.status === 'driver_arrived' || ride.status === 'in_progress'
  const canAddStop = ride.status === 'accepted' || ride.status === 'driver_arrived' || ride.status === 'in_progress'
  const canCancel = ride.status === 'accepted' || ride.status === 'driver_arrived'
  const fare = ride.totalFinal != null
    ? `₹${Math.round(parseFloat(ride.totalFinal))}`
    : ride.totalEstimated != null ? `₹${Math.round(parseFloat(ride.totalEstimated))}` : null

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
      />

      <View style={[styles.mapOverlayTop, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        {!socketConnected ? <ReconnectBanner /> : null}
        {canAddStop ? (
          <Pressable onPress={() => setAddStopOpen(true)} style={styles.addStopBtn} accessibilityLabel="Add a stop">
            <Feather name="plus" size={13} color={colors.ink600} />
            <Text style={styles.addStopText}>Add stop</Text>
          </Pressable>
        ) : null}
        {addStopError ? <Text style={styles.addStopError}>{addStopError}</Text> : null}
      </View>

      <SOSButton
        enabled={!isCompleted && !isCancelled}
        onTrigger={() => triggerSos(rideId, riderLat ?? undefined, riderLng ?? undefined)}
        anchor="top-right"
      />

      <Animated.View style={[styles.sheet, sheetEntranceStyle]}>
        <View style={styles.handle} />
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={[styles.sheetContent, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
          showsVerticalScrollIndicator={false}
        >
          {upgradeCategory ? <UpgradeToast categoryName={upgradeCategory} /> : null}
          {fareDrift ? (
            <FareDriftToast previousFare={fareDrift.previousFare} currentFare={fareDrift.currentFare} onDismiss={dismissFareDrift} />
          ) : null}

          <StatusBanner status={status} eta={eta} />

          {isSearching ? (
            <View style={styles.searchingBlock}>
              <Text style={styles.searchingTitle}>Finding your driver…</Text>
              <Text style={styles.searchingBody}>Hang tight, we're matching you with a nearby driver.</Text>
              <Pressable
                onPress={cancelSearch}
                disabled={cancelling}
                accessibilityRole="button"
                accessibilityLabel="Cancel this ride request"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.cancelButton}
              >
                <Text style={styles.cancelButtonText}>{cancelling ? 'Cancelling…' : 'Cancel'}</Text>
              </Pressable>
            </View>
          ) : null}

          {hasDriver ? (
            <DriverCard
              ride={ride}
              stale={stale}
              otp={isAssigned ? ride.startOtp : isInProgress ? ride.endOtp : null}
              otpLabel={isInProgress ? 'End PIN' : 'Start PIN'}
              rideId={rideId}
              canCall={canCall}
              unreadChatCount={unreadChatCount}
              onOpenChat={() => router.push(`/ride/${rideId}/chat`)}
            />
          ) : null}

          {/* Address + fare live only here, collapsed by default -- available
              on demand (Rapido's trip-detail expand) instead of a fare number
              sitting permanently in front of the rider. Offered for any
              driver-assigned ride, not just one with stops -- a stopless ride
              (the common case) previously had no way to see the address at all. */}
          {hasDriver ? (
            <Pressable onPress={() => setDetailsExpanded((v) => !v)} style={styles.detailsToggle}>
              <Text style={styles.detailsToggleText}>{detailsExpanded ? 'Hide trip details' : 'Trip details'}</Text>
              <Feather name={detailsExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.ink400} />
            </Pressable>
          ) : null}
          {detailsExpanded && hasDriver ? (
            <View style={styles.detailsExpanded}>
              <TripDetailsCard ride={ride} fare={!isCompleted ? fare : null} />
              {ride.stops.length > 0 ? <StopTimeline stops={ride.stops} /> : null}
            </View>
          ) : null}

          {/* Low-emphasis text link, not an icon button floating in the open --
              matches Ola/Uber's own "Cancel ride" placement, a deliberate
              action tucked at the bottom of the sheet, not the loudest thing
              on screen next to the fare. */}
          {hasDriver && canCancel ? (
            <Pressable onPress={() => setShowCancelSheet(true)} style={styles.cancelLink} hitSlop={8}>
              <Text style={styles.cancelLinkText}>Cancel ride</Text>
            </Pressable>
          ) : null}

          {isCompleted ? (
            <>
              <View style={styles.completeRow}>
                <Feather name="check-circle" size={14} color={colors.success} />
                <Text style={styles.completeText}>Trip complete</Text>
                {fare ? <Text style={styles.completeFare}>{fare}</Text> : null}
              </View>
              {ride.userRatingGiven == null ? (
                <Pressable onPress={() => router.push(`/ride/${rideId}/rate`)} style={styles.rateBtn}>
                  <Feather name="star" size={14} color={colors.warning} />
                  <Text style={styles.rateBtnText}>Rate your driver</Text>
                  <Feather name="chevron-right" size={14} color={colors.ink400} />
                </Pressable>
              ) : (
                <View style={styles.ratedRow}>
                  <Feather name="star" size={13} color={colors.warning} />
                  <Text style={styles.ratedText}>You rated this ride {ride.userRatingGiven}/5</Text>
                </View>
              )}
            </>
          ) : null}

          {isCancelled ? (
            <View style={styles.cancelledRow}>
              <Text style={styles.cancelledText}>Returning to home…</Text>
            </View>
          ) : null}

          {needsCashCollection ? <CashCollectionBanner amount={ride.totalFinal ?? ride.totalEstimated} /> : null}
        </ScrollView>
      </Animated.View>

      <CancelSheet
        visible={showCancelSheet}
        feeWarning={ride.status === 'accepted' || ride.status === 'driver_arrived'}
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
    </View>
  )
}

const SCREEN_HEIGHT = Dimensions.get('window').height

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  skeletonBlock: { marginBottom: spacing.md },
  mapOverlayTop: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: spacing.md, gap: spacing.xs, zIndex: 5 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: SCREEN_HEIGHT * MAX_SHEET_HEIGHT_RATIO,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: 'rgba(15,23,42,1)',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: spacing.sm, marginBottom: spacing.xs },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, gap: spacing.md },
  searchingBlock: { gap: spacing.xs, alignItems: 'center', paddingVertical: spacing.sm },
  searchingTitle: { ...typography.title, color: colors.ink900 },
  searchingBody: { ...typography.body, color: colors.ink600, textAlign: 'center' },
  cancelButton: { marginTop: spacing.xs, padding: spacing.xs },
  cancelButtonText: { ...typography.body, color: colors.error, fontWeight: '600' },
  cancelLink: { alignItems: 'center', paddingVertical: spacing.xs },
  cancelLinkText: { ...typography.label, color: colors.error, fontWeight: '700' },
  detailsExpanded: { gap: spacing.sm },
  // Floats on the map, top-right below the "Add stop" pill.
  addStopBtn: {
    alignSelf: 'flex-end',
    // Clears the SOS button (56px circle, anchored top-right by SOSButton's
    // own `anchor="top-right"` positioning) -- both were landing in the same
    // corner with no coordination between the two, since SOS is positioned
    // by its own component and this pill only knew about its own container.
    marginTop: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 4,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  addStopText: { ...typography.caption, color: colors.ink600, fontWeight: '600' },
  addStopError: { ...typography.caption, color: colors.error, alignSelf: 'flex-end', backgroundColor: colors.surface, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.md },
  detailsToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: spacing.xs },
  detailsToggleText: { ...typography.caption, color: colors.ink400, fontWeight: '600' },
  completeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.successLight, borderRadius: radii.lg, padding: spacing.sm + 4 },
  completeText: { ...typography.body, color: colors.success, fontWeight: '700', flex: 1 },
  completeFare: { ...typography.title, color: colors.ink900, fontWeight: '800' },
  rateBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.bg, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.sm + 4 },
  rateBtnText: { ...typography.body, color: colors.ink900, fontWeight: '700', flex: 1 },
  ratedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, justifyContent: 'center', paddingVertical: spacing.xs },
  ratedText: { ...typography.caption, color: colors.ink400, fontWeight: '600' },
  cancelledRow: { alignItems: 'center', padding: spacing.md },
  cancelledText: { ...typography.body, color: colors.error, fontWeight: '600' },
})
