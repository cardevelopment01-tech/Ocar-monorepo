import { useEffect, useState } from 'react'
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { Button, CancelSheet, ErrorState, SOSButton, Skeleton, colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useActiveRide } from '@/features/active-ride/useActiveRide'
import { OtpEntryCard } from '@/features/active-ride/components/OtpEntryCard'
import { CashCollectionCard } from '@/features/active-ride/components/CashCollectionCard'
import { TripCompletionCard } from '@/features/active-ride/components/TripCompletionCard'
import { RateRiderSheet } from '@/features/active-ride/components/RateRiderSheet'
import { RiderActionsRow } from '@/features/active-ride/components/RiderActionsRow'
import { RideSheet } from '@/features/active-ride/components/RideSheet'
import { RideTypeBadge } from '@/features/active-ride/components/RideTypeBadge'
import { SlideToConfirm } from '@/features/active-ride/components/SlideToConfirm'
import { TripBody } from '@/features/active-ride/components/TripBody'
import { ArrivedBanner } from '@/features/active-ride/components/ArrivedBanner'
import { PulsingDot } from '@/features/active-ride/components/PulsingDot'
import { ActiveRideMap } from '@/features/active-ride/components/ActiveRideMap'
import { SpeedAlertToast } from '@/features/active-ride/components/SpeedAlertToast'
import { triggerSos } from '@/features/active-ride/safety-api'
import { useDriverLivePosition } from '@/features/active-ride/useDriverLivePosition'
import { useSpeedAlert } from '@/features/active-ride/useSpeedAlert'

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
    markArrivedAction,
    submitStartOtpAction,
    submitEndOtpAction,
    collectCashAction,
    cancelRideAction,
    startReturnAction,
  } = useActiveRide(rideId)

  const driverRating = useAuthStore((s) => s.driver?.rating ?? null)
  const [cashResult, setCashResult] = useState<{ collected: number } | null>(null)
  const [cashLoading, setCashLoading] = useState(false)
  const [rateSheetOpen, setRateSheetOpen] = useState(true)
  const [showCancelSheet, setShowCancelSheet] = useState(false)

  // No-op on the hardware back button while a ride is active -- a driver can't
  // accidentally back out mid-trip (Eng/Design review finding).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => sub.remove()
  }, [])

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

  const expectedFare = parseFloat(ride.totalEstimated ?? ride.totalFinal ?? '0')

  async function handleConfirmCashFull() {
    setCashLoading(true)
    const result = await collectCashAction({ collectedAmount: expectedFare })
    setCashLoading(false)
    if (result) setCashResult({ collected: result.collected })
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

  return (
    <View style={styles.container}>
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

      <SOSButton
        enabled={status !== 'completed'}
        onTrigger={() => triggerSos(rideId, live?.position[0], live?.position[1])}
        anchor="top-right"
      />

      <SpeedAlertToast alertKey={alertKey} limitKmph={limitKmph} />

      {status === 'completed' && cashResult ? (
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
            onConfirmFull={() => void handleConfirmCashFull()}
            onPartialOrNotCollected={(input) => void handlePartialCash(input)}
          />
        </RideSheet>
      ) : status === 'in_progress' ? (
        <RideSheet>
          <TripBody
            rideId={rideId}
            riderName={ride.riderName}
            navigateTo={navigateTarget}
            unreadChatCount={unreadChatCount}
            onOpenChat={handleOpenChat}
            actionError={actionError}
            // Locked headline copy (Token Mapping table, hardening design doc).
            headline="On your trip"
            badge={isRental ? <RideTypeBadge kind="rental" /> : undefined}
            destinationLabel={isRental ? 'Flexible route' : (ride.destinationAddress ?? 'Destination')}
            stops={ride.stops}
            pendingStop={pendingStop}
            onStopResolved={reload}
            primaryAction={
              isRoundTrip ? (
                // Round-trip's single primary CTA is "start return", not "end
                // trip" -- matches web's primaryAction (TripInProgress.tsx:477-486):
                // a round_trip ride never shows the end-OTP card until the return
                // leg has actually started. SlideToConfirm (not a tap button) so a
                // ride can't end early by accident, same affordance CashCollectionCard
                // already uses on this screen.
                <SlideToConfirm
                  key="start-return"
                  label="Slide to start return"
                  color={colors.warning}
                  onConfirm={() => void startReturnAction()}
                />
              ) : (
                <OtpEntryCard
                  key="end-otp"
                  title="End Ride OTP"
                  subtitle="Ask the rider for their end OTP"
                  submitLabel="End trip"
                  loading={false}
                  error={actionError}
                  onSubmit={(otp) => submitEndOtpAction(otp)}
                />
              )
            }
          />
        </RideSheet>
      ) : status === 'returning' ? (
        <RideSheet>
          <TripBody
            rideId={rideId}
            riderName={ride.riderName}
            navigateTo={navigateTarget}
            unreadChatCount={unreadChatCount}
            onOpenChat={handleOpenChat}
            actionError={actionError}
            headline="Heading back"
            badge={<RideTypeBadge kind="return" />}
            destinationLabel={ride.originAddress ?? 'Pickup point'}
            stops={ride.stops}
            pendingStop={pendingStop}
            onStopResolved={reload}
            primaryAction={
              <OtpEntryCard
                key="end-otp"
                title="End Ride OTP"
                subtitle="Ask the rider for their end OTP"
                submitLabel="End trip"
                loading={false}
                error={actionError}
                onSubmit={(otp) => submitEndOtpAction(otp)}
              />
            }
          />
        </RideSheet>
      ) : status === 'driver_arrived' ? (
        <RideSheet>
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          <ArrivedBanner riderName={ride.riderName} />
          <View style={styles.divider} />
          <RiderActionsRow rideId={rideId} riderName={ride.riderName} navigateTo={navigateTarget} unreadChatCount={unreadChatCount} onOpenChat={handleOpenChat} />
          <OtpEntryCard
            key="start-otp"
            title="Rider OTP"
            subtitle="Ask the rider for their 4-digit OTP"
            submitLabel="Start trip"
            loading={false}
            error={actionError}
            onSubmit={(otp) => submitStartOtpAction(otp)}
          />
        </RideSheet>
      ) : (
        <RideSheet>
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          <RiderActionsRow rideId={rideId} riderName={ride.riderName} navigateTo={navigateTarget} unreadChatCount={unreadChatCount} onOpenChat={handleOpenChat} />
          <View style={styles.divider} />
          {/* Pulsing dot + single-line truncated address, matching web's
              NavigateToPickup.tsx instruction row -- replaces the previous
              plain two-line title/address block. */}
          <View style={styles.addressRow}>
            <PulsingDot />
            <View style={styles.addressTextCol}>
              <Text style={styles.addressLabel}>Heading to pickup</Text>
              <Text style={styles.addressValue} numberOfLines={1}>
                {ride.originAddress ?? 'Pickup location'}
              </Text>
            </View>
          </View>
          <Button label="I've arrived" icon="check-circle" onPress={() => void markArrivedAction()} />
          <Pressable onPress={() => setShowCancelSheet(true)} style={styles.cancelLink} hitSlop={8}>
            <Feather name="x" size={14} color={colors.error} />
            <Text style={styles.cancelLinkText}>Cancel ride</Text>
          </Pressable>
        </RideSheet>
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
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  addressTextCol: { flex: 1, minWidth: 0, gap: 1 },
  addressLabel: { ...typography.caption, color: colors.ink400 },
  addressValue: { ...typography.title, color: colors.ink900 },
  cancelLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm },
  cancelLinkText: { ...typography.label, color: colors.error, fontWeight: '600' },
})
