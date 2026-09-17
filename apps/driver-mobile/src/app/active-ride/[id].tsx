import { useEffect, useState } from 'react'
import { BackHandler, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Button, Card, ErrorState, Skeleton, colors, spacing, typography } from '@ocar/mobile-shared'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { useActiveRide } from '@/features/active-ride/useActiveRide'
import { OtpEntryCard } from '@/features/active-ride/components/OtpEntryCard'
import { CashCollectionCard } from '@/features/active-ride/components/CashCollectionCard'
import { TripCompletionCard } from '@/features/active-ride/components/TripCompletionCard'

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

  // No-op on the hardware back button while a ride is active -- a driver can't
  // accidentally back out mid-trip (Eng/Design review finding).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => sub.remove()
  }, [])

  if (loading) {
    return (
      <View style={styles.container}>
        <Skeleton height={24} width="60%" />
        <Skeleton height={80} />
      </View>
    )
  }

  if (loadError || !ride) {
    return (
      <View style={styles.container}>
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

  return (
    <View style={styles.container}>
      {actionError ? (
        <Card style={styles.errorCard}>
          <Text style={styles.error}>{actionError}</Text>
        </Card>
      ) : null}

      {status === 'completed' && cashResult ? (
        <TripCompletionCard fareEarned={cashResult.collected} onBackToOnline={handleBackToOnline} />
      ) : status === 'completed' ? (
        <CashCollectionCard
          expectedFare={expectedFare}
          loading={cashLoading}
          error={null}
          onConfirmFull={() => void handleConfirmCashFull()}
          onPartialOrNotCollected={(input) => void handlePartialCash(input)}
        />
      ) : status === 'in_progress' ? (
        <>
          <Card style={styles.card}>
            <Text style={styles.title}>Trip in progress</Text>
            <Text style={styles.detail} numberOfLines={2}>
              → {ride.destinationAddress ?? 'Destination'}
            </Text>
          </Card>
          <OtpEntryCard
            title="Enter end OTP"
            submitLabel="End trip"
            loading={false}
            error={actionError}
            onSubmit={(otp) => void submitEndOtpAction(otp)}
          />
        </>
      ) : status === 'driver_arrived' ? (
        <OtpEntryCard
          title="Enter start OTP"
          submitLabel="Start trip"
          loading={false}
          error={actionError}
          onSubmit={(otp) => void submitStartOtpAction(otp)}
        />
      ) : (
        <Card style={styles.card}>
          <Text style={styles.title}>Head to pickup</Text>
          <Text style={styles.detail} numberOfLines={2}>
            {ride.originAddress ?? 'Pickup location'}
          </Text>
          <Button label="I've arrived" onPress={() => void markArrivedAction()} />
        </Card>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, backgroundColor: colors.bg, gap: spacing.md },
  card: { gap: spacing.sm },
  errorCard: { gap: spacing.xs },
  title: { ...typography.title, color: colors.ink900 },
  detail: { ...typography.body, color: colors.ink600 },
  error: { ...typography.label, color: colors.error },
})
