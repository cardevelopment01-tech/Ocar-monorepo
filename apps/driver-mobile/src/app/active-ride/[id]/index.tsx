import { useEffect, useState } from 'react'
import { BackHandler, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Button, ErrorState, SOSButton, Skeleton, colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useActiveRide } from '@/features/active-ride/useActiveRide'
import { OtpEntryCard } from '@/features/active-ride/components/OtpEntryCard'
import { StopCard } from '@/features/active-ride/components/StopCard'
import { CashCollectionCard } from '@/features/active-ride/components/CashCollectionCard'
import { TripCompletionCard } from '@/features/active-ride/components/TripCompletionCard'
import { RateRiderSheet } from '@/features/active-ride/components/RateRiderSheet'
import { RiderActionsRow } from '@/features/active-ride/components/RiderActionsRow'
import { RideSheet } from '@/features/active-ride/components/RideSheet'
import { ArrivedBanner } from '@/features/active-ride/components/ArrivedBanner'
import { PulsingDot } from '@/features/active-ride/components/PulsingDot'
import { ActiveRideMap } from '@/features/active-ride/components/ActiveRideMap'
import { triggerSos } from '@/features/active-ride/safety-api'
import { useDriverLivePosition } from '@/features/active-ride/useDriverLivePosition'

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
  } = useActiveRide(rideId)

  const driverRating = useAuthStore((s) => s.driver?.rating ?? null)
  const [cashResult, setCashResult] = useState<{ collected: number } | null>(null)
  const [cashLoading, setCashLoading] = useState(false)
  const [rateSheetOpen, setRateSheetOpen] = useState(true)

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

  // The map is always the whole screen, not a boxed inset -- every ride
  // state docks its content in one RideSheet floating over it (Uber
  // convention), instead of a Card stranded at the top with the rest of
  // the viewport left dead.
  const destination = ride.destLat != null && ride.destLng != null ? ([ride.destLat, ride.destLng] as [number, number]) : null
  const showsDestination = status === 'in_progress' || status === 'completed'
  const pickup: [number, number] = [ride.originLat, ride.originLng]
  const navigateTarget = showsDestination && destination ? destination : pickup
  const pendingStop = ride.stops.find((s) => s.status === 'pending') ?? null

  return (
    <View style={styles.container}>
      <ActiveRideMap
        pickup={pickup}
        destination={showsDestination ? destination : null}
        leg={showsDestination ? 'to-destination' : 'to-pickup'}
        stops={ride.stops.filter((s) => s.status === 'pending').map((s): [number, number] => [s.lat, s.lng])}
      />

      <SOSButton
        enabled={status !== 'completed'}
        onTrigger={() => triggerSos(rideId, live?.position[0], live?.position[1])}
        anchor="top-right"
      />

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
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          <RiderActionsRow rideId={rideId} riderName={ride.riderName} navigateTo={navigateTarget} unreadChatCount={unreadChatCount} onOpenChat={handleOpenChat} />
          <Text style={styles.title}>Trip in progress</Text>
          <Text style={styles.detail} numberOfLines={2}>
            → {ride.destinationAddress ?? 'Destination'}
          </Text>
          {/* key is required here (unlike RideSheet, which must never have one --
              see its own comment) -- start-otp and end-otp are different
              OtpEntryCard elements in different ternary branches, but React
              reconciles same-type siblings at the same tree position as the
              SAME instance by default. Without a key, the end-otp card
              inherited the start-otp card's leftover typed digits on the
              driver_arrived -> in_progress transition, and its onSubmit fired
              immediately with that stale value -- a real end-trip verification
              call using a code the rider never gave for that step. */}
          {/* The backend hard-blocks end-otp (409 RIDE_HAS_PENDING_STOPS) while
              any stop is still pending -- this app had no way to ever resolve
              a rider-added stop, so a driver who got one added was
              permanently stuck seeing a generic "Could not confirm" error on
              the end-OTP card with no indication why. Show the actual
              blocking action instead of the OTP card until it's resolved. */}
          {pendingStop ? (
            <StopCard
              key={`stop-${pendingStop.sequence}`}
              rideId={rideId}
              sequence={pendingStop.sequence}
              address={pendingStop.address}
              onResolved={reload}
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
          )}
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
        </RideSheet>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centeredState: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  title: { ...typography.title, color: colors.ink900 },
  detail: { ...typography.body, color: colors.ink600 },
  error: { ...typography.label, color: colors.error, backgroundColor: colors.errorLight, borderRadius: radii.md, padding: spacing.sm, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  addressTextCol: { flex: 1, minWidth: 0, gap: 1 },
  addressLabel: { ...typography.caption, color: colors.ink400 },
  addressValue: { ...typography.title, color: colors.ink900 },
})
