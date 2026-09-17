import { useEffect, useRef, useState } from 'react'
import { BackHandler, Modal, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Button, Card, colors, formatCurrency, formatDistanceKm, spacing, typography } from '@ocar/mobile-shared'
import { useRideRequestStore } from '@/store/useRideRequestStore'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { acceptRideRequest } from './api'
import { computeRemainingSeconds } from './countdown'

const WARNING_THRESHOLD_SECONDS = 5
const DISMISS_DELAY_MS = 1500

// Renders above whatever screen is active (mounted once at the root, per the
// design review's information-hierarchy fix -- an incoming request must
// interrupt any tab, not just the home tab).
export function RideRequestOverlay() {
  const pending = useRideRequestStore((s) => s.pending)
  const clearPending = useRideRequestStore((s) => s.clearPending)
  const setActiveRide = useDriverSessionStore((s) => s.setActiveRide)

  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [isResponding, setIsResponding] = useState(false)
  const [dismissReason, setDismissReason] = useState<'expired' | 'raceLost' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setDismissReason(null)
    setError(null)
    setIsResponding(false)
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
  }, [pending?.rideId])

  useEffect(() => {
    if (!pending || dismissReason) return
    const tick = () => {
      const remaining = computeRemainingSeconds(pending.timeoutSeconds, pending.receivedAtMs, Date.now())
      setRemainingSeconds(remaining)
      if (remaining <= 0) {
        setDismissReason('expired')
      }
    }
    tick()
    const interval = setInterval(tick, 250)
    return () => clearInterval(interval)
  }, [pending, dismissReason])

  useEffect(() => {
    if (!dismissReason || !pending) return
    dismissTimerRef.current = setTimeout(() => clearPending(pending.rideId), DISMISS_DELAY_MS)
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    }
  }, [dismissReason, pending, clearPending])

  // Android back button on this overlay = reject-with-confirm, distinct from the
  // active-ride screens' own back-button handling (Design/Eng review finding).
  useEffect(() => {
    if (!pending) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      clearPending(pending.rideId)
      return true
    })
    return () => sub.remove()
  }, [pending, clearPending])

  if (!pending) return null

  async function handleAccept() {
    if (isResponding || dismissReason || !pending) return
    setIsResponding(true)
    setError(null)
    try {
      const result = await acceptRideRequest(pending.rideId)
      if (result.ride) setActiveRide({ id: result.ride.id, status: result.ride.status })
      clearPending(pending.rideId)
      router.push(`/active-ride/${pending.rideId}`)
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code
      if (code === 'RIDE_ALREADY_ASSIGNED') {
        setDismissReason('raceLost')
      } else {
        setError('Could not accept. Try again.')
        setIsResponding(false)
      }
    }
  }

  function handleReject() {
    if (isResponding || !pending) return
    clearPending(pending.rideId)
  }

  const isUrgent = remainingSeconds <= WARNING_THRESHOLD_SECONDS
  const remainingLabel = Math.ceil(remainingSeconds)

  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.backdrop}>
        <Card style={styles.card}>
          {dismissReason === 'raceLost' ? (
            <Text style={styles.message}>Already accepted by another driver</Text>
          ) : dismissReason === 'expired' ? (
            <Text style={styles.message}>Request expired</Text>
          ) : (
            <>
              <View style={styles.countdownTrack}>
                <View
                  style={[
                    styles.countdownFill,
                    { width: `${Math.max(0, (remainingSeconds / pending.timeoutSeconds) * 100)}%` },
                    isUrgent && styles.countdownFillUrgent,
                  ]}
                />
              </View>
              <Text style={styles.fare}>{formatCurrency(pending.estimatedFare)}</Text>
              <Text style={styles.address} numberOfLines={2}>
                {pending.pickup}
              </Text>
              <Text style={styles.detail}>{formatDistanceKm(pending.distanceToPickup / 1000)} to pickup</Text>
              <Text style={styles.address} numberOfLines={2}>
                → {pending.drop}
              </Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <View style={styles.actionButton}>
                  <Button label="Reject" variant="secondary" onPress={handleReject} disabled={isResponding} />
                </View>
                <View style={styles.actionButton}>
                  <Button
                    label="Accept"
                    onPress={() => void handleAccept()}
                    loading={isResponding}
                    disabled={isResponding}
                    accessibilityLabel={`Accept ride, ${remainingLabel} seconds remaining`}
                  />
                </View>
              </View>
            </>
          )}
        </Card>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: `${colors.ink900}CC`, justifyContent: 'center', padding: spacing.lg },
  card: { gap: spacing.sm },
  countdownTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surface3, overflow: 'hidden' },
  countdownFill: { height: '100%', backgroundColor: colors.primary },
  countdownFillUrgent: { backgroundColor: colors.warning },
  fare: { ...typography.display, color: colors.ink900 },
  address: { ...typography.body, color: colors.ink900 },
  detail: { ...typography.label, color: colors.ink600 },
  error: { ...typography.label, color: colors.error },
  message: { ...typography.title, color: colors.ink900, textAlign: 'center', paddingVertical: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionButton: { flex: 1, minHeight: 48 },
})
