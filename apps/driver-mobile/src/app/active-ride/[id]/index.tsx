import { type ReactNode, useEffect, useState } from 'react'
import { Alert, BackHandler, Pressable, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { CancelSheet, ErrorState, SOSButton, Skeleton, TripClock, colors, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useActiveRide } from '@/features/active-ride/useActiveRide'
import { OtpEntryCard } from '@/features/active-ride/components/OtpEntryCard'
import { CashCollectionCard } from '@/features/active-ride/components/CashCollectionCard'
import { TripCompletionCard } from '@/features/active-ride/components/TripCompletionCard'
import { RateRiderSheet } from '@/features/active-ride/components/RateRiderSheet'
import { RiderActionsRow } from '@/features/active-ride/components/RiderActionsRow'
import { RideSheet } from '@/features/active-ride/components/RideSheet'
import { StageSheet } from '@/features/active-ride/components/StageSheet'
import type { StageHeaderProps } from '@/features/active-ride/components/StageHeader'
import { RideTypeBadge } from '@/features/active-ride/components/RideTypeBadge'
import { SlideToConfirm } from '@/features/active-ride/components/SlideToConfirm'
import { StopCard } from '@/features/active-ride/components/StopCard'
import { StopTimeline } from '@/features/active-ride/components/StopTimeline'
import { StopAddedBanner } from '@/features/active-ride/components/StopAddedBanner'
import { ActiveRideMap } from '@/features/active-ride/components/ActiveRideMap'
import { GoogleGuidedMap, GUIDED_CONTROLS_HEIGHT } from '@/features/active-ride/components/GoogleGuidedMap'
import { SpeedAlertToast } from '@/features/active-ride/components/SpeedAlertToast'
import { triggerSos } from '@/features/active-ride/safety-api'
import { useDriverLivePosition } from '@/features/active-ride/useDriverLivePosition'
import { useSpeedAlert } from '@/features/active-ride/useSpeedAlert'
import { useTripWindow } from '@/features/active-ride/useTripWindow'

// SOSButton's circle diameter, to centre it in the guided-nav control strip.
const SOS_SIZE = 56

// Same reason list as web driver's NavigateToPickup.tsx:691-698 (the confirmed
// source for driver-side cancel reasons per the hardening design doc).
const CANCEL_REASONS = [
  { code: 'passenger_not_found', label: 'Passenger not at pickup' },
  { code: 'passenger_no_show', label: 'Passenger did not show up' },
  { code: 'rider_requested', label: 'Rider asked me to cancel' },
  { code: 'vehicle_breakdown', label: 'Vehicle breakdown' },
  { code: 'wrong_booking', label: 'Wrong booking details' },
  { code: 'emergency', label: 'Emergency' },
  { code: 'other', label: 'Other reason' },
]

export default function ActiveRideScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const rideId = id ?? ''
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const clearActiveRide = useDriverSessionStore((s) => s.setActiveRide)
  const {
    ride,
    loading,
    loadError,
    status,
    actionError,
    unreadChatCount,
    clearUnreadChatCount,
    reload,
    refresh,
    stopNotice,
    endedExternally,
    clearStopNotice,
    markArrivedAction,
    submitStartOtpAction,
    submitEndOtpAction,
    collectCashAction,
    cancelRideAction,
    startReturnAction,
    arrivedAtDropAction,
  } = useActiveRide(rideId)

  const driverRating = useAuthStore((s) => s.driver?.rating ?? null)
  const [cashResult, setCashResult] = useState<{ collected: number } | null>(null)
  const [cashLoading, setCashLoading] = useState(false)
  const [rateSheetOpen, setRateSheetOpen] = useState(true)
  const [showCancelSheet, setShowCancelSheet] = useState(false)
  // Local, per-trip view state -- not persisted, not an admin config. Default is
  // always the in-house map; tapping "Navigate" swaps to the Google-guided view in
  // place, which swaps back on Close or final-destination arrival. See
  // driver-mobile-nav-mode-design.md for why this shape (not a settings toggle).
  const [navView, setNavView] = useState<'diy' | 'guided'>('diy')

  // No-op on the hardware back button while a ride is active -- a driver can't
  // accidentally back out mid-trip (Eng/Design review finding).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => sub.remove()
  }, [])

  // Rider/system cancel or admin force-resolve: nothing left to do on this ride. Leaving
  // unmounts GoogleGuidedMap, which tears the native nav session down.
  useEffect(() => {
    if (!endedExternally) return
    setNavView('diy')
    clearActiveRide(null)
    Alert.alert('Ride ended', endedExternally)
    router.replace('/(tabs)/home')
  }, [endedExternally, clearActiveRide, router])

  // Trip settled (e.g. server-side end) while guided nav owns the screen: the sheet with the
  // cash/completion UI is hidden behind it, so drop back to DIY -- which also unmounts
  // GoogleGuidedMap and tears the native session down.
  useEffect(() => {
    if (status === 'completed') setNavView('diy')
  }, [status])

  // Must run on every render, including the loading/error early-returns below --
  // a hook called only after those guards passed 1 more hook on the "ride loaded"
  // render than the "still loading" render, which is a Rules-of-Hooks violation
  // React throws on ("Rendered more hooks than during the previous render"). That
  // crash hit every app launch once a ride was persisted active, since restoring
  // straight into this screen re-triggers the loading->loaded transition.
  const live = useDriverLivePosition(true)
  // Trip-in-progress and the return leg -- both are "driving with a rider
  // context active" (start-otp has fired, end-otp hasn't yet), matching the
  // hardening doc's "driver-facing only, during the ride" scope. Off for
  // accepted/driver_arrived (driver may be moving fast on an empty highway
  // approach with no ride constraint on it) and completed.
  const { alertKey, limitKmph } = useSpeedAlert(status === 'in_progress' || status === 'returning')
  // Booked-time clock for hourly round trips (null copy = no window: one-way, rental, legacy pricing).
  const tripClock = useTripWindow(ride)

  if (loading) {
    return (
      <View style={styles.centeredState}>
        <Skeleton height={24} width="60%" />
        <Skeleton height={80} />
      </View>
    )
  }

  if (loadError || !ride) {
    return (
      <View style={styles.centeredState}>
        <ErrorState message="Couldn't load this ride." onRetry={reload} />
      </View>
    )
  }

  // The settled fare wins once it exists: the server expects cash against total_final (overtime, extra km,
  // rental overage all land there), so collecting against the quote records a false shortfall.
  const expectedFare = parseFloat(ride.totalFinal ?? ride.totalEstimated ?? '0')

  // Resolves false on failure so the cash slider springs back instead of sticking on "Confirmed".
  async function handleConfirmCashFull(): Promise<boolean> {
    setCashLoading(true)
    const result = await collectCashAction({ collectedAmount: expectedFare })
    setCashLoading(false)
    if (result) setCashResult({ collected: result.collected })
    return !!result
  }

  async function handlePartialCash(input: { collectedAmount?: number; notCollected?: boolean; note: string }) {
    setCashLoading(true)
    const result = await collectCashAction(input)
    setCashLoading(false)
    if (result) setCashResult({ collected: result.collected })
  }

  function handleBackToOnline() {
    clearActiveRide(null)
    router.replace('/(tabs)/home')
  }

  function handleOpenChat() {
    clearUnreadChatCount()
    router.push(`/active-ride/${rideId}/chat`)
  }

  // Matches web's handleCancelRide (NavigateToPickup.tsx) -- CancelSheet only
  // shown pre-arrival, so success always means "back to online", never a
  // mid-status screen to unwind.
  async function handleConfirmCancel(reasonCode: string) {
    await cancelRideAction(reasonCode)
    setShowCancelSheet(false)
    clearActiveRide(null)
    router.replace('/(tabs)/home')
  }

  // The map is always the whole screen, not a boxed inset -- every ride
  // state docks its content in one RideSheet floating over it (Uber
  // convention), instead of a Card stranded at the top with the rest of
  // the viewport left dead.
  const destination = ride.destLat != null && ride.destLng != null ? ([ride.destLat, ride.destLng] as [number, number]) : null
  const pickup: [number, number] = [ride.originLat, ride.originLng]
  // 'returning' targets pickup, not dropLat/dropLng -- the backend's
  // startReturn only stamps return_started_at, it never rewrites the ride's
  // drop coordinates (rides.service.ts:845), so the original outbound
  // destination stays on the record throughout the return leg. Mirrors
  // rider-mobile's useRideTracking.ts routeMode ('returning' -> driver-pickup
  // waypoints), the confirmed-correct reference -- not web driver's dropPos,
  // which stays pinned to the outbound destination through the return leg.
  const showsDestination = status === 'in_progress' || status === 'completed'
  const isReturning = status === 'returning'
  const navigateTarget = isReturning ? pickup : showsDestination && destination ? destination : pickup
  const pendingStop = ride.stops.find((s) => s.status === 'pending') ?? null
  const isRoundTrip = ride.rideType === 'round_trip'
  const isRental = ride.rideType === 'rental'

  // Same reachability gating as ActiveRideMap's own stops prop below -- a stop is
  // only routed through once it's reachable on the current leg.
  const guidedStops =
    status === 'in_progress' || isReturning
      ? ride.stops.filter((s) => s.status === 'pending').map((s) => ({ sequence: s.sequence, lat: s.lat, lng: s.lng }))
      : []

  // ── Stage sheet content: accepted -> driver_arrived -> in_progress -> returning ──
  // One header + one pinned primary action per stage; while a rider-added stop is pending the
  // header becomes that stop, so the sheet never has two competing headlines.
  const stopPosition = pendingStop ? ride.stops.indexOf(pendingStop) + 1 : 0
  // Booked hours stay visible on every round-trip stage, so the driver never has to remember them.
  const roundTripBadge = isRoundTrip && ride.tripHours ? <RideTypeBadge kind="round_trip" hours={ride.tripHours} /> : null
  // The end code is only asked for after "Arrived at drop": that tap is also what releases the rider's PIN.
  const endStage = ride.dropArrivedAt ? (
    <OtpEntryCard phase="end" riderName={ride.riderName} error={actionError} onSubmit={(otp) => submitEndOtpAction(otp)} />
  ) : (
    <SlideToConfirm label="Slide when you arrive at drop" doneLabel="Arrived" onConfirm={arrivedAtDropAction} />
  )
  let header: StageHeaderProps
  let primary: ReactNode
  let stageKey: string
  if (pendingStop && (status === 'in_progress' || isReturning)) {
    header = {
      icon: 'map-pin', tone: 'stop', label: `Stop ${stopPosition} of ${ride.stops.length}`, title: pendingStop.address ?? 'Stop location',
      ...(roundTripBadge ? { badge: roundTripBadge } : {}),
    }
    primary = (
      <StopCard
        rideId={rideId}
        sequence={pendingStop.sequence}
        meterWait={ride.rideType === 'one_way'}
        arrivedAt={pendingStop.arrivedAt}
        onResolved={refresh}
      />
    )
    stageKey = `stop-${pendingStop.sequence}-${pendingStop.arrivedAt ? 'waiting' : 'arriving'}`
  } else if (status === 'in_progress') {
    // Locked headline copy (Token Mapping table, hardening design doc).
    header = {
      icon: 'flag',
      label: 'On your trip',
      title: isRental ? 'Flexible route' : (ride.destinationAddress ?? 'Destination'),
      ...(isRental ? { badge: <RideTypeBadge kind="rental" /> } : roundTripBadge ? { badge: roundTripBadge } : {}),
    }
    primary = isRoundTrip ? (
      // Round-trip's single primary CTA is "start return", not "end trip" -- matches web's
      // primaryAction (TripInProgress.tsx): a round_trip ride never shows the end-OTP card
      // until the return leg has started. SlideToConfirm (not a tap button) so a ride can't
      // end early by accident, same affordance CashCollectionCard uses.
      <SlideToConfirm label="Slide to start return" doneLabel="Starting return" onConfirm={startReturnAction} />
    ) : endStage
    stageKey = isRoundTrip ? 'trip-return' : ride.dropArrivedAt ? 'trip-end' : 'trip-arrive'
  } else if (status === 'returning') {
    header = {
      icon: 'corner-up-left', label: 'Heading back', title: ride.originAddress ?? 'Pickup point',
      badge: <>{roundTripBadge}<RideTypeBadge kind="return" /></>,
    }
    primary = endStage
    stageKey = ride.dropArrivedAt ? 'returning' : 'returning-arrive'
  } else if (status === 'driver_arrived') {
    header = {
      icon: 'user-check', label: "You've arrived", title: ride.riderName ? `Pick up ${ride.riderName}` : 'Pick up the rider',
      ...(roundTripBadge ? { badge: roundTripBadge } : {}),
    }
    primary = <OtpEntryCard phase="start" riderName={ride.riderName} error={actionError} onSubmit={(otp) => submitStartOtpAction(otp)} />
    stageKey = 'arrived'
  } else {
    header = {
      icon: 'navigation', label: 'Heading to pickup', title: ride.originAddress ?? 'Pickup location',
      ...(roundTripBadge ? { badge: roundTripBadge } : {}),
    }
    primary = <SlideToConfirm label="Slide when you arrive" doneLabel="Arrived" onConfirm={markArrivedAction} />
    stageKey = 'pickup'
  }

  return (
    <View style={styles.container}>
      {navView === 'guided' ? (
        <GoogleGuidedMap
          rideId={rideId}
          destination={navigateTarget}
          stops={guidedStops}
          meterWait={ride.rideType === 'one_way'}
          onClose={() => setNavView('diy')}
          onStopResolved={refresh}
        />
      ) : (
        <ActiveRideMap
          pickup={pickup}
          destination={showsDestination || isReturning ? destination : null}
          leg={isReturning ? 'to-pickup' : showsDestination ? 'to-destination' : 'to-pickup'}
          // Gated here, not just inside ActiveRideMap -- 'accepted'/'driver_arrived'
          // share the same leg='to-pickup' value 'returning' reuses, and a stop can
          // legitimately be pending before pickup too (STOP_ADDABLE_STATUSES
          // includes accepted/driver_arrived). Only route through pending stops
          // once they're actually reachable on this leg: in_progress (before the
          // destination) or returning (after it, heading back to pickup) --
          // never while still heading to pickup for the first time (code-review
          // finding, 2026-09-22).
          stops={
            status === 'in_progress' || isReturning
              ? ride.stops.filter((s) => s.status === 'pending').map((s): [number, number] => [s.lat, s.lng])
              : []
          }
        />
      )}

      <SOSButton
        enabled={status !== 'completed'}
        onTrigger={() => triggerSos(rideId, live?.position[0], live?.position[1])}
        anchor={navView === 'guided' ? 'bottom-right' : 'top-right'}
        {...(navView === 'guided' ? { offset: insets.bottom + (GUIDED_CONTROLS_HEIGHT - SOS_SIZE) / 2 } : {})}
      />

      <SpeedAlertToast alertKey={alertKey} limitKmph={limitKmph} />

      {/* Rider added a stop mid-trip -- tap to dismiss. Hidden while guided nav
          owns the whole screen (the guided map re-routes itself to include it). */}
      <StopAddedBanner
        message={navView === 'diy' && status !== 'completed' ? (stopNotice?.message ?? null) : null}
        noticeKey={stopNotice?.key ?? 0}
        onDismiss={clearStopNotice}
      />

      {/* The guided map covers the whole screen and has its own "Close guidance"
          button (bottom-left) -- the ride-status sheet would otherwise dock over
          that exact corner and make it unreachable (code-review finding: driver
          gets stuck in guided nav with no way back to the DIY view/rider actions). */}
      {navView !== 'diy' ? null : status === 'completed' && cashResult ? (
        <>
          <RideSheet>
            <TripCompletionCard
              ride={ride}
              collectedCash={cashResult.collected}
              driverRating={driverRating}
              onBackToOnline={handleBackToOnline}
            />
          </RideSheet>
          <RateRiderSheet
            visible={rateSheetOpen}
            rideId={rideId}
            riderName={ride.riderName}
            onClose={() => setRateSheetOpen(false)}
          />
        </>
      ) : status === 'completed' ? (
        <RideSheet>
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          <CashCollectionCard
            expectedFare={expectedFare}
            riderName={ride.riderName}
            loading={cashLoading}
            error={null}
            onConfirmFull={handleConfirmCashFull}
            onPartialOrNotCollected={(input) => void handlePartialCash(input)}
          />
        </RideSheet>
      ) : (
        <StageSheet
          header={header}
          primary={primary}
          stageKey={stageKey}
          clock={
            (status === 'in_progress' || isReturning) && tripClock.copy
              ? <TripClock copy={tripClock.copy} stateKey={tripClock.state.kind} />
              : null
          }
        >
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          <RiderActionsRow
            rideId={rideId}
            riderName={ride.riderName}
            navigateTo={navigateTarget}
            unreadChatCount={unreadChatCount}
            onOpenChat={handleOpenChat}
            onNavigate={() => setNavView('guided')}
          />
          {/* Stops the rider added are listed in every stage, including before pickup, so none is a surprise. */}
          <StopTimeline stops={ride.stops} />
          {/* Backend allows driver cancel through driver_arrived too (CANCELLABLE_BY_DRIVER, rides.service.ts). */}
          {status === 'accepted' || status === 'driver_arrived' ? (
            <Pressable onPress={() => setShowCancelSheet(true)} style={styles.cancelLink} accessibilityRole="button" accessibilityLabel="Cancel ride">
              <Feather name="x" size={16} color={colors.ink600} />
              <Text style={styles.cancelLinkText}>Cancel ride</Text>
            </Pressable>
          ) : null}
        </StageSheet>
      )}

      <CancelSheet
        visible={showCancelSheet}
        reasons={CANCEL_REASONS}
        onClose={() => setShowCancelSheet(false)}
        onConfirm={handleConfirmCancel}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centeredState: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  error: { ...typography.label, color: colors.error, backgroundColor: colors.errorLight, borderRadius: radii.md, padding: spacing.sm, overflow: 'hidden' },
  // Tertiary: plain text, no fill. Cancel is destructive and rare; the confirm step lives in CancelSheet.
  cancelLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2, minHeight: 44 },
  cancelLinkText: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold },
})
