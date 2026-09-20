import { useEffect, useState } from 'react'
import { BackHandler, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Button, ErrorState, SOSButton, Skeleton, colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { useActiveRide } from '@/features/active-ride/useActiveRide'
import { OtpEntryCard } from '@/features/active-ride/components/OtpEntryCard'
import { CashCollectionCard } from '@/features/active-ride/components/CashCollectionCard'
import { TripCompletionCard } from '@/features/active-ride/components/TripCompletionCard'
import { RateRiderSheet } from '@/features/active-ride/components/RateRiderSheet'
import { RiderActionsRow } from '@/features/active-ride/components/RiderActionsRow'
import { RideSheet } from '@/features/active-ride/components/RideSheet'
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
    reload,
    markArrivedAction,
    submitStartOtpAction,
    submitEndOtpAction,
    collectCashAction,
  } = useActiveRide(rideId)

  const [cashResult, setCashResult] = useState<{ collected: number } | null>(null)
  const [cashLoading, setCashLoading] = useState(false)
  const [rateSheetOpen, setRateSheetOpen] = useState(true)

  // No-op on the hardware back button while a ride is active -- a driver can't
  // accidentally back out mid-trip (Eng/Design review finding).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => sub.remove()
  }, [])

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

  // The map is always the whole screen, not a boxed inset -- every ride
  // state docks its content in one RideSheet floating over it (Uber
  // convention), instead of a Card stranded at the top with the rest of
  // the viewport left dead.
  const destination = ride.destLat != null && ride.destLng != null ? ([ride.destLat, ride.destLng] as [number, number]) : null
  const showsDestination = status === 'in_progress' || status === 'completed'
  const pickup: [number, number] = [ride.originLat, ride.originLng]
  const navigateTarget = showsDestination && destination ? destination : pickup
  const live = useDriverLivePosition(true)

  return (
    <View style={styles.container}>
      <ActiveRideMap
        pickup={pickup}
        destination={showsDestination ? destination : null}
        leg={showsDestination ? 'to-destination' : 'to-pickup'}
      />

      <SOSButton
        enabled={status !== 'completed'}
        onTrigger={() => triggerSos(rideId, live?.position[0], live?.position[1])}
      />

      {status === 'completed' && cashResult ? (
        <>
          <RideSheet key="trip-complete">
            <TripCompletionCard fareEarned={cashResult.collected} onBackToOnline={handleBackToOnline} />
          </RideSheet>
          <RateRiderSheet
            visible={rateSheetOpen}
            rideId={rideId}
            riderName={ride.riderName}
            onClose={() => setRateSheetOpen(false)}
          />
        </>
      ) : status === 'completed' ? (
        <RideSheet key="collect-cash">
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          <CashCollectionCard
            expectedFare={expectedFare}
            loading={cashLoading}
            error={null}
            onConfirmFull={() => void handleConfirmCashFull()}
            onPartialOrNotCollected={(input) => void handlePartialCash(input)}
          />
        </RideSheet>
      ) : status === 'in_progress' ? (
        <RideSheet key="in-progress">
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          <RiderActionsRow rideId={rideId} riderName={ride.riderName} navigateTo={navigateTarget} />
          <Text style={styles.title}>Trip in progress</Text>
          <Text style={styles.detail} numberOfLines={2}>
            → {ride.destinationAddress ?? 'Destination'}
          </Text>
          <OtpEntryCard
            title="Enter end OTP"
            submitLabel="End trip"
            loading={false}
            error={null}
            onSubmit={(otp) => void submitEndOtpAction(otp)}
          />
        </RideSheet>
      ) : status === 'driver_arrived' ? (
        <RideSheet key="start-otp">
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          <RiderActionsRow rideId={rideId} riderName={ride.riderName} navigateTo={navigateTarget} />
          <OtpEntryCard
            title="Enter start OTP"
            submitLabel="Start trip"
            loading={false}
            error={null}
            onSubmit={(otp) => void submitStartOtpAction(otp)}
          />
        </RideSheet>
      ) : (
        <RideSheet key="head-to-pickup">
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          <RiderActionsRow rideId={rideId} riderName={ride.riderName} navigateTo={navigateTarget} />
          <Text style={styles.title}>Head to pickup</Text>
          <Text style={styles.detail} numberOfLines={2}>
            {ride.originAddress ?? 'Pickup location'}
          </Text>
          <Button label="I've arrived" onPress={() => void markArrivedAction()} />
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
})
