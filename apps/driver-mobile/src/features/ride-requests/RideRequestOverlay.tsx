import { useEffect, useRef, useState } from 'react'
import { BackHandler, Modal, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { router } from 'expo-router'
import { Button, Card, colors, formatCurrency, formatDistanceKm, spacing, typography } from '@ocar/mobile-shared'
import { useRideRequestStore } from '@/store/useRideRequestStore'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { acceptRideRequest } from './api'
import { computeRemainingSeconds } from './countdown'
import { useRideAlertSound } from './useRideAlertSound'

const WARNING_THRESHOLD_SECONDS = 5
const DISMISS_DELAY_MS = 1500

// Uber-style circular countdown ring around the fare, replacing the old linear
// bar. Same radius math as a standard SVG progress ring: stroke-dashoffset
// counts down from 0 (full circle) to the full circumference (empty).
const RING_SIZE = 96
const RING_STROKE = 6
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

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

  // Rings while a request is actually up for response -- stops the instant it
  // resolves (accept/reject/expire/race-lost), matching the web driver app's
  // playRideSound()/stopRideSound() lifecycle.
  useRideAlertSound(!!pending && !dismissReason)

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
              <View style={styles.ringRow}>
                <View style={styles.ringWrap}>
                  <Svg width={RING_SIZE} height={RING_SIZE} style={styles.ringSvg}>
                    <Circle
                      cx={RING_SIZE / 2}
                      cy={RING_SIZE / 2}
                      r={RING_RADIUS}
                      stroke={colors.surface3}
                      strokeWidth={RING_STROKE}
                      fill="none"
                    />
                    <Circle
                      cx={RING_SIZE / 2}
                      cy={RING_SIZE / 2}
                      r={RING_RADIUS}
                      stroke={isUrgent ? colors.warning : colors.primary}
                      strokeWidth={RING_STROKE}
                      fill="none"
                      strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
                      strokeDashoffset={RING_CIRCUMFERENCE * (1 - remainingSeconds / pending.timeoutSeconds)}
                      strokeLinecap="round"
                      // Ring starts at 12 o'clock and depletes clockwise, matching the
                      // conventional countdown-timer reading direction.
                      rotation={-90}
                      originX={RING_SIZE / 2}
                      originY={RING_SIZE / 2}
                    />
                  </Svg>
                  <Text style={styles.ringSeconds} accessibilityLabel={`${remainingLabel} seconds remaining`}>
                    {remainingLabel}
                  </Text>
                </View>
                <View style={styles.fareCol}>
                  <Text style={styles.fareLabel}>Fare</Text>
                  <Text style={styles.fare}>{formatCurrency(pending.estimatedFare)}</Text>
                  <Text style={styles.distance}>{formatDistanceKm(pending.distanceToPickup / 1000)} to pickup</Text>
                </View>
              </View>
              <View style={styles.addressBlock}>
                <View style={styles.addressRow}>
                  <View style={[styles.addressDot, styles.addressDotPickup]} />
                  <Text style={styles.address} numberOfLines={2}>
                    {pending.pickup}
                  </Text>
                </View>
                <View style={styles.addressRow}>
                  <View style={[styles.addressDot, styles.addressDotDrop]} />
                  <Text style={styles.address} numberOfLines={2}>
                    {pending.drop}
                  </Text>
                </View>
              </View>
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
  card: { gap: spacing.md },
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ringWrap: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
  ringSvg: { position: 'absolute' },
  ringSeconds: { ...typography.title, color: colors.ink900, fontWeight: '700' },
  fareCol: { flex: 1, gap: 2 },
  fareLabel: { ...typography.caption, color: colors.ink400, fontWeight: '600' },
  fare: { ...typography.display, color: colors.ink900 },
  distance: { ...typography.label, color: colors.ink600 },
  addressBlock: { gap: spacing.xs },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  addressDot: { width: 8, height: 8, borderRadius: 4 },
  addressDotPickup: { backgroundColor: colors.success },
  addressDotDrop: { backgroundColor: colors.error },
  address: { ...typography.body, color: colors.ink900, flex: 1 },
  error: { ...typography.label, color: colors.error },
  message: { ...typography.title, color: colors.ink900, textAlign: 'center', paddingVertical: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionButton: { flex: 1, minHeight: 48 },
})
