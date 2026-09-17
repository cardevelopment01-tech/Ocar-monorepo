import { useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Card, ErrorState, Skeleton, colors, spacing, typography } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { DriverCard } from '@/features/ride-tracking/components/DriverCard'
import { LiveMarker } from '@/features/ride-tracking/components/LiveMarker'
import { OtpDisplay } from '@/features/ride-tracking/components/OtpDisplay'
import { CashCollectionBanner } from '@/features/ride-tracking/components/CashCollectionBanner'
import { ReconnectBanner } from '@/features/ride-tracking/components/ReconnectBanner'
import { DriverCancelledBanner } from '@/features/ride-tracking/components/DriverCancelledBanner'
import { useRideTracking } from '@/features/ride-tracking/useRideTracking'
import { ASSIGNED_STATUSES, IN_PROGRESS_STATUSES, SEARCHING_STATUSES } from '@/features/ride-tracking/types'

const STALE_LOCATION_MS = 3 * 60 * 1000

export default function RideTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const rideId = id ?? ''
  const router = useRouter()
  const {
    ride,
    loading,
    loadError,
    socketConnected,
    driverCancelled,
    lastLocationAt,
    markerLat,
    markerLng,
    retry,
  } = useRideTracking(rideId)

  const stale = useMemo(
    () => lastLocationAt != null && Date.now() - lastLocationAt > STALE_LOCATION_MS,
    [lastLocationAt]
  )

  const cancelInFlightRef = useRef(false)
  const [cancelling, setCancelling] = useState(false)

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
  const needsCashCollection = isCompleted && (ride.paymentChannel ?? 'cash') === 'cash' && !ride.cashCollectedAt

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {!socketConnected ? <ReconnectBanner /> : null}

      {isSearching ? (
        <Card style={styles.searchingCard}>
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
        </Card>
      ) : null}

      {(isAssigned || isInProgress) && ride.driverId ? <DriverCard ride={ride} stale={stale} /> : null}

      {(isAssigned || isInProgress) && ride.driverId ? (
        <LiveMarker
          markerLat={markerLat}
          markerLng={markerLng}
          originLat={ride.originLat}
          originLng={ride.originLng}
          destLat={ride.destLat}
          destLng={ride.destLng}
          caption={isAssigned ? 'Driver is on the way to pickup' : 'On trip'}
        />
      ) : null}

      {isAssigned && ride.startOtp ? <OtpDisplay label="Start OTP" otp={ride.startOtp} /> : null}
      {isInProgress && ride.endOtp ? <OtpDisplay label="End OTP" otp={ride.endOtp} /> : null}

      {needsCashCollection ? <CashCollectionBanner amount={ride.totalFinal ?? ride.totalEstimated} /> : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  skeletonBlock: { marginBottom: spacing.md },
  searchingCard: { gap: spacing.xs, alignItems: 'center' },
  searchingTitle: { ...typography.title, color: colors.ink900 },
  searchingBody: { ...typography.body, color: colors.ink600, textAlign: 'center' },
  cancelButton: { marginTop: spacing.xs, padding: spacing.xs },
  cancelButtonText: { ...typography.body, color: colors.error, fontWeight: '600' },
})
