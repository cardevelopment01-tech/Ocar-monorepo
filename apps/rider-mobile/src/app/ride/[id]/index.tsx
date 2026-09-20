import { useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Card, ErrorState, Skeleton, colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { DriverCard } from '@/features/ride-tracking/components/DriverCard'
import { RideMapView } from '@/features/ride-tracking/components/RideMapView'
import { StatusBanner } from '@/features/ride-tracking/components/StatusBanner'
import { DriverActionsRow } from '@/features/ride-tracking/components/DriverActionsRow'
import { CancelSheet } from '@/features/ride-tracking/components/CancelSheet'
import { AddStopSheet } from '@/features/ride-tracking/components/AddStopSheet'
import { StopTimeline } from '@/features/ride-tracking/components/StopTimeline'
import { FareDriftToast, UpgradeToast } from '@/features/ride-tracking/components/Toasts'
import { CashCollectionBanner } from '@/features/ride-tracking/components/CashCollectionBanner'
import { ReconnectBanner } from '@/features/ride-tracking/components/ReconnectBanner'
import { DriverCancelledBanner } from '@/features/ride-tracking/components/DriverCancelledBanner'
import { useRideTracking } from '@/features/ride-tracking/useRideTracking'
import { cancelRide, addStop, type StopInput } from '@/features/ride-tracking/api'
import { ASSIGNED_STATUSES, IN_PROGRESS_STATUSES, SEARCHING_STATUSES } from '@/features/ride-tracking/types'
import type { StatusKey } from '@/features/ride-tracking/statusConfig'

const STALE_LOCATION_MS = 3 * 60 * 1000

export default function RideTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const rideId = id ?? ''
  const router = useRouter()
  const {
    ride, loading, loadError, socketConnected, driverCancelled, lastLocationAt,
    driverPos, driverHeading, driverHeadingKnown, pickup, drop, routePoints, eta, unreadChatCount,
    fareDrift, dismissFareDrift, upgradeCategory, retry,
  } = useRideTracking(rideId)

  const stale = useMemo(
    () => lastLocationAt != null && Date.now() - lastLocationAt > STALE_LOCATION_MS,
    [lastLocationAt]
  )

  const cancelInFlightRef = useRef(false)
  const [cancelling, setCancelling] = useState(false)
  const [showCancelSheet, setShowCancelSheet] = useState(false)
  const [addStopOpen, setAddStopOpen] = useState(false)
  const [addStopError, setAddStopError] = useState<string | null>(null)
  const [detailsExpanded, setDetailsExpanded] = useState(false)

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
  const fare = ride.totalFinal != null
    ? `₹${Math.round(parseFloat(ride.totalFinal))}`
    : ride.totalEstimated != null ? `₹${Math.round(parseFloat(ride.totalEstimated))}` : null

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {!socketConnected ? <ReconnectBanner /> : null}

      <View style={styles.mapBleed}>
        <RideMapView
          pickup={pickup}
          drop={drop}
          driverPos={hasDriver ? driverPos : null}
          driverHeading={driverHeading}
          driverHeadingKnown={driverHeadingKnown}
          routePoints={routePoints}
          showDrop={drop != null}
        />
      </View>

      <StatusBanner status={status} eta={eta} />

      {upgradeCategory ? <UpgradeToast categoryName={upgradeCategory} /> : null}
      {fareDrift ? (
        <FareDriftToast previousFare={fareDrift.previousFare} currentFare={fareDrift.currentFare} onDismiss={dismissFareDrift} />
      ) : null}

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

      {hasDriver ? (
        <View style={styles.driverRow}>
          <View style={{ flex: 1 }}>
            <DriverCard
              ride={ride}
              stale={stale}
              otp={isAssigned ? ride.startOtp : isInProgress ? ride.endOtp : null}
              otpLabel={isInProgress ? 'End PIN' : 'Start PIN'}
            />
          </View>
          <DriverActionsRow
            rideId={rideId}
            canCall={canCall}
            unreadChatCount={unreadChatCount}
            onOpenChat={() => router.push(`/ride/${rideId}/chat`)}
          />
        </View>
      ) : null}

      {hasDriver && fare && !isCompleted ? (
        <View style={styles.fareRow}>
          <Text style={styles.fareLabel}>{ride.totalFinal != null ? 'Fare' : 'Est. fare'}</Text>
          <Text style={styles.fareValue}>{fare}</Text>
        </View>
      ) : null}

      {(ride.status === 'accepted' || ride.status === 'driver_arrived') ? (
        <Pressable onPress={() => setShowCancelSheet(true)} style={styles.cancelRideBtn}>
          <Feather name="x" size={14} color={colors.error} />
          <Text style={styles.cancelRideText}>Cancel ride</Text>
        </Pressable>
      ) : null}

      {canAddStop ? (
        <>
          <Pressable onPress={() => setAddStopOpen(true)} style={styles.addStopBtn}>
            <Feather name="plus" size={13} color={colors.ink600} />
            <Text style={styles.addStopText}>Add stop</Text>
          </Pressable>
          {addStopError ? <Text style={styles.addStopError}>{addStopError}</Text> : null}
        </>
      ) : null}

      {ride.stops.length > 0 ? (
        <Pressable onPress={() => setDetailsExpanded((v) => !v)} style={styles.detailsToggle}>
          <Text style={styles.detailsToggleText}>{detailsExpanded ? 'Hide trip details' : 'Trip details'}</Text>
          <Feather name={detailsExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.ink400} />
        </Pressable>
      ) : null}
      {detailsExpanded && ride.stops.length > 0 ? <StopTimeline stops={ride.stops} /> : null}

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
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  // Cancels the ScrollView's own padding so the map runs edge-to-edge at
  // the top instead of floating as a boxed inset inside it.
  mapBleed: { marginHorizontal: -spacing.lg, marginTop: -spacing.lg },
  skeletonBlock: { marginBottom: spacing.md },
  searchingCard: { gap: spacing.xs, alignItems: 'center' },
  searchingTitle: { ...typography.title, color: colors.ink900 },
  searchingBody: { ...typography.body, color: colors.ink600, textAlign: 'center' },
  cancelButton: { marginTop: spacing.xs, padding: spacing.xs },
  cancelButtonText: { ...typography.body, color: colors.error, fontWeight: '600' },
  driverRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xs },
  fareLabel: { ...typography.caption, color: colors.ink400, fontWeight: '600' },
  fareValue: { ...typography.title, color: colors.ink900, fontWeight: '800' },
  cancelRideBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.sm + 4, borderRadius: radii.lg, backgroundColor: colors.errorLight, borderWidth: 1, borderColor: colors.error },
  cancelRideText: { ...typography.body, color: colors.error, fontWeight: '700' },
  addStopBtn: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, borderRadius: radii.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  addStopText: { ...typography.caption, color: colors.ink600, fontWeight: '600' },
  addStopError: { ...typography.caption, color: colors.error },
  detailsToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: spacing.xs },
  detailsToggleText: { ...typography.caption, color: colors.ink400, fontWeight: '600' },
  completeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.successLight, borderRadius: radii.lg, padding: spacing.sm + 4 },
  completeText: { ...typography.body, color: colors.success, fontWeight: '700', flex: 1 },
  completeFare: { ...typography.title, color: colors.ink900, fontWeight: '800' },
  rateBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.sm + 4 },
  rateBtnText: { ...typography.body, color: colors.ink900, fontWeight: '700', flex: 1 },
  ratedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, justifyContent: 'center', paddingVertical: spacing.xs },
  ratedText: { ...typography.caption, color: colors.ink400, fontWeight: '600' },
  cancelledRow: { alignItems: 'center', padding: spacing.md },
  cancelledText: { ...typography.body, color: colors.error, fontWeight: '600' },
})
