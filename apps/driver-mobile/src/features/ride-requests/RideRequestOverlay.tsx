import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BackHandler, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather } from '@expo/vector-icons'
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { scheduleOnRN } from 'react-native-worklets'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, fonts, radii, spacing, Text } from '@ocar/mobile-shared'
import { useRideRequestStore } from '@/store/useRideRequestStore'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { GlassChip } from '@/features/go-online/components/ModeHero'
import { acceptRideRequest, declineRideRequest } from './api'
import { computeRemainingSeconds } from './countdown'
import { useRideAlertSound } from './useRideAlertSound'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

const WARNING_THRESHOLD_SECONDS = 5
const PAN_DISMISS_PX = 120
const PAN_DISMISS_VELOCITY = 850
const RING = 64
const RING_STROKE = 4
const RING_R = (RING - RING_STROKE) / 2
// Edge-to-edge Modal: the 3-button Android nav bar is not in the safe-area insets here, so the actions
// row (the one thing that must be tappable instantly) was drawn under it and clipped.
const ANDROID_NAV_CLEARANCE = 56

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1)

type Resolved = 'accepted' | 'expired' | 'raceLost' | 'rejected'

// "Geeta Bhawan, Dakabangala Chhaka, Bhubaneswar, Odisha 751014" -> the place a driver recognises on the
// first line, the rest of the address quietly under it (never cut mid-postcode).
function splitAddress(address: string): { name: string; rest: string } {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean)
  return { name: parts[0] ?? address, rest: parts.slice(1).join(', ') }
}

function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(1)} km`
}

export function RideRequestOverlay() {
  const pending = useRideRequestStore((s) => s.pending)
  const clearPending = useRideRequestStore((s) => s.clearPending)
  const setActiveRide = useDriverSessionStore((s) => s.setActiveRide)

  const { height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const reduced = useReducedMotion()

  const [status, setStatus] = useState<'show' | Resolved>('show')
  const [seconds, setSeconds] = useState(0)
  const [isAccepting, setIsAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dismissedRef = useRef(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // --- Motion state (all on the UI thread) -----------------------------------
  const sheetY = useSharedValue(0)
  const sheetOpacity = useSharedValue(1)
  const backdropOpacity = useSharedValue(0)
  const ringProgress = useSharedValue(1)
  const dragStartY = useSharedValue(0)

  const rideId = pending?.rideId
  const resolved = status !== 'show'
  const isUrgent = !!pending && seconds <= WARNING_THRESHOLD_SECONDS && !resolved

  // Repeating alert while the request is live and unanswered.
  useRideAlertSound(!!pending && !resolved)

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }, [])

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms)
    timersRef.current.push(id)
  }, [])

  /** Slide the sheet away (same path it arrived by) then release the store. */
  const animateOut = useCallback(
    (rideIdToClear: string) => {
      if (dismissedRef.current) return
      dismissedRef.current = true
      backdropOpacity.set(withTiming(0, { duration: reduced ? 160 : 220, easing: reduced ? EASE_OUT : EASE_IN_OUT }))
      if (reduced) {
        sheetOpacity.set(withTiming(0, { duration: 160, easing: EASE_OUT }))
      } else {
        sheetY.set(withSpring(height, { duration: 300, dampingRatio: 0.9 }))
      }
      schedule(() => clearPending(rideIdToClear), 250)
    },
    [backdropOpacity, clearPending, height, reduced, schedule, sheetOpacity, sheetY],
  )

  const reject = useCallback(() => {
    if (dismissedRef.current || pending?.rideId == null) return
    setStatus('rejected')
    void declineRideRequest(pending.rideId)
    animateOut(pending.rideId)
  }, [animateOut, pending?.rideId])

  const handleBack = useCallback((): boolean => {
    if (!pending) return false
    reject()
    return true
  }, [pending, reject])

  // Reset everything the moment a new ride request lands.
  useEffect(() => {
    if (!pending) return
    clearTimers()
    dismissedRef.current = false
    setStatus('show')
    setSeconds(pending.timeoutSeconds)
    setAccepted(false)
    setIsAccepting(false)
    setError(null)

    // Deplete the ring across the whole accept window on the UI thread.
    ringProgress.set(1)
    ringProgress.set(
      withTiming(0, {
        duration: pending.timeoutSeconds * 1000,
        easing: Easing.linear,
        reduceMotion: ReduceMotion.Never, // informational progress -- allowed in reduced mode
      }),
    )

    // Sheet + backdrop arrival. Spring for the sheet (finger-adjacent physics), a
    // short ease-out fade for the scrim. Reduced motion: cross-fade only.
    sheetOpacity.set(1)
    if (reduced) {
      sheetY.set(0)
      backdropOpacity.set(withTiming(1, { duration: 220, easing: EASE_OUT }))
    } else {
      sheetY.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }))
      backdropOpacity.set(withTiming(1, { duration: 260, easing: EASE_OUT }))
    }

    return () => clearTimers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId])

  // Live countdown (the JS clock is the source of truth for the visible seconds;
  // the ring itself depletes on the UI thread so it stays smooth).
  useEffect(() => {
    if (!pending || resolved) return
    const tick = () => {
      const remaining = computeRemainingSeconds(pending.timeoutSeconds, pending.receivedAtMs, Date.now())
      setSeconds(Math.ceil(remaining))
      if (remaining <= 0) setStatus('expired')
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [pending, resolved])

  // Autodismiss the terminal messages gracefully.
  useEffect(() => {
    if (!pending?.rideId) return
    // A driver who never taps anything (the countdown just runs out) never hit
    // reject()'s declineRideRequest call either -- without this, the assignment
    // stays 'offered' server-side and the next socket reconnect (screen change,
    // network blip, going back online) replays the exact same offer and restarts
    // the ringtone, same bug as an un-propagated Decline tap.
    if (status === 'expired') {
      void declineRideRequest(pending.rideId)
      schedule(() => animateOut(pending.rideId as string), 1200)
    }
    if (status === 'raceLost') schedule(() => animateOut(pending.rideId as string), 1500)
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Android hardware back = reject (deliberate, distinct from in-ride screens).
  useEffect(() => {
    if (!pending) return
    const sub = BackHandler.addEventListener('hardwareBackPress', handleBack)
    return () => sub.remove()
  }, [pending, handleBack])

  async function handleAccept() {
    if (isAccepting || accepted || dismissedRef.current || !pending) return
    setIsAccepting(true)
    setError(null)
    try {
      const result = await acceptRideRequest(pending.rideId)
      if (result.ride) setActiveRide({ id: result.ride.id, status: result.ride.status })
      setAccepted(true)
      setStatus('accepted')
      dismissedRef.current = true
      // Success beat, then into the ride.
      schedule(() => {
        router.push(`/active-ride/${pending.rideId}`)
        clearPending(pending.rideId)
      }, 650)
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code
      if (code === 'RIDE_ALREADY_ASSIGNED') setStatus('raceLost')
      else {
        setError('Could not accept. Try again.')
        setIsAccepting(false)
      }
    }
  }

  // --- Gesture: drag the sheet down to reject (direct manipulation) ----------
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!reduced && !resolved)
        .onBegin(() => {
          dragStartY.set(sheetY.get())
        })
        .onUpdate((e) => {
          const pulled = dragStartY.get() + e.translationY
          // Rubber-band the upward bound so you can nudge it but it resists.
          sheetY.set(Math.max(0, pulled < 0 ? pulled * 0.35 : pulled))
        })
        .onEnd((e) => {
          const shouldDismiss = e.translationY > PAN_DISMISS_PX || e.velocityY > PAN_DISMISS_VELOCITY
          if (shouldDismiss) {
            sheetY.set(withSpring(height, { duration: 300, dampingRatio: 0.9, velocity: e.velocityY }))
            scheduleOnRN(reject)
          } else {
            // Snap back from wherever the drag left it, inheriting the finger's
            // velocity so the release seam is invisible.
            sheetY.set(withSpring(0, { duration: 300, dampingRatio: 0.8, velocity: e.velocityY }))
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [height, reduced, resolved, reject],
  )

  const sheetStyle = useAnimatedStyle(() => ({ opacity: sheetOpacity.get(), transform: [{ translateY: sheetY.get() }] }))
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.get() }))
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: (1 - ringProgress.get()) * 100 }))

  // Staggered entrance for the info blocks -- never the actions row, which must be
  // tappable the instant it lands (don't shrink the real reaction window).
  const entrances = useMemo(() => {
    const mk = (i: number) =>
      reduced
        ? FadeIn.duration(140).delay(i * 30)
        : FadeInDown.duration(240).delay(60 + i * 40).withInitialValues({ transform: [{ translateY: 10 }] })
    return [mk(0), mk(1)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId, reduced])

  if (!pending) return null

  const km = pending.distanceToPickup / 1000
  const etaMin = km > 0 ? Math.max(1, Math.round(km / 0.6)) : 0
  const secondsLeft = Math.max(0, seconds)
  const isRound = pending.rideType === 'round_trip'
  const isReturn = pending.isReturnCab || isRound
  const isRental = pending.rideType === 'rental'
  const stopCount = pending.stopCount ?? 0
  const returnAtFormatted = pending.returnAt
    ? new Date(pending.returnAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
    : null

  const typeLabel = isRound
    ? (pending.tripHours ? `Round trip · ${pending.tripHours}h` : 'Round trip')
    : isRental ? (pending.tripHours ? `Rental · ${pending.tripHours}h` : 'Rental')
    : isReturn ? 'Return trip' : 'One way'
  const payLabel = pending.paymentChannel === 'online' ? 'Online' : pending.paymentChannel === 'wallet' ? 'Wallet' : pending.paymentChannel === 'cash' ? 'Cash' : null

  const pickup = splitAddress(pending.pickup)
  const drop = splitAddress(pending.drop)
  const tripKm = pending.tripKm ? Math.max(1, Math.round(pending.tripKm)) : 0
  const hours = pending.tripHours ?? 0
  // Two identical blocks, each: label (left) + its metrics (right), place name, address.
  // The drop block's metrics depend on the ride: a one-way is a distance and a time, a round trip is its
  // one-way distance (the server stores the one-way route), a rental is its hours and included distance.
  const pickupMetric = `${formatKm(km)}${etaMin ? ` · ${etaMin} min` : ''}`
  // A rental always has a destination (the server requires one); it is still a rental, so it is labelled as one.
  const dropLabel = isRental ? 'Rental destination' : isRound ? 'Drop and return' : 'Drop'
  const dropMetric = isRental
    ? [hours ? `${hours}h` : null, pending.kmLimit ? `${pending.kmLimit} km` : null].filter(Boolean).join(' · ')
    : isRound
      ? (tripKm ? `${tripKm} km each way` : '')
      : [tripKm ? `${tripKm} km` : null, pending.tripMin ? `${pending.tripMin} min` : null].filter(Boolean).join(' · ')
  const dropName = drop.name
  const dropRest = drop.rest
  // What a driver also needs to know before taking a long job: how long they are committed, and the terms.
  const facts: { icon: 'clock' | 'corner-up-left' | 'navigation' | 'user'; text: string }[] = []
  if (isRound) {
    if (hours) facts.push({ icon: 'clock', text: `${hours}h booked` })
    facts.push({ icon: 'corner-up-left', text: returnAtFormatted ? `Return by ${returnAtFormatted}` : 'Return to the pickup point' })
  } else if (isRental) {
    if (hours) facts.push({ icon: 'clock', text: `${hours}h booked` })
    if (pending.kmLimit) facts.push({ icon: 'navigation', text: `${pending.kmLimit} km included` })
    facts.push({ icon: 'user', text: 'Stay with the rider for the booked time' })
  }

  const ringColor = isUrgent ? colors.error : colors.primary
  const showActions = status === 'show'
  const showTerminal = status === 'expired' || status === 'raceLost'
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? ANDROID_NAV_CLEARANCE : 0) + spacing.md

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={handleBack}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, backdropStyle]} />

        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.sheetWrap, sheetStyle]}>
            {/* Hero band: type, payment and the fare, the three things the accept decision hangs on. */}
            <LinearGradient colors={['#0B4A50', '#0E8FA3']} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={styles.band}>
              <View style={styles.handle} />
              <Animated.View entering={entrances[0]} style={styles.bandInner}>
                <View style={styles.chipRow}>
                  <GlassChip icon={isRental ? 'clock' : isReturn ? 'corner-up-left' : 'arrow-right'} label={typeLabel} />
                  {stopCount > 0 ? <GlassChip label={stopCount === 1 ? '1 stop' : `${stopCount} stops`} /> : null}
                </View>
                <View style={styles.fareRow} accessible accessibilityLabel={`Estimated fare ${Math.round(pending.estimatedFare)} rupees${payLabel ? `, ${payLabel}` : ''}`}>
                  <Text style={styles.fare} maxFontSizeMultiplier={1.15}>₹{Math.round(pending.estimatedFare).toLocaleString('en-IN')}</Text>
                  {payLabel ? <Text style={styles.pay}>{payLabel}</Text> : null}
                </View>
                <Text style={styles.fareNote}>Estimated fare</Text>
              </Animated.View>
            </LinearGradient>

            <View style={[styles.body, { paddingBottom: bottomPad }]}>
              <Animated.View entering={entrances[1]} style={styles.route}>
                <View style={styles.rail}>
                  <View style={styles.dotPickup} />
                  <View style={styles.railLine} />
                  <View style={styles.dotDrop} />
                </View>
                <View style={styles.legs}>
                  <View style={styles.leg}>
                    <View style={styles.legHeader}>
                      <Text style={styles.legLabel}>Pickup</Text>
                      <Text style={styles.legMetric}>{pickupMetric}</Text>
                    </View>
                    <Text style={styles.place} numberOfLines={1}>{pickup.name}</Text>
                    {pickup.rest ? <Text style={styles.placeRest} numberOfLines={2}>{pickup.rest}</Text> : null}
                  </View>
                  <View style={styles.legDivider} />
                  <View style={styles.leg}>
                    <View style={styles.legHeader}>
                      <Text style={styles.legLabel}>{dropLabel}</Text>
                      {dropMetric ? <Text style={styles.legMetric}>{dropMetric}</Text> : null}
                    </View>
                    <Text style={styles.place} numberOfLines={1}>{dropName}</Text>
                    {dropRest ? <Text style={styles.placeRest} numberOfLines={2}>{dropRest}</Text> : null}
                  </View>
                </View>
              </Animated.View>

              {facts.length ? (
                <View style={styles.facts}>
                  {facts.map((f) => (
                    <View key={f.text} style={styles.fact}>
                      <Feather name={f.icon} size={15} color={colors.primaryDark} />
                      <Text style={styles.factText}>{f.text}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {error && status === 'show' ? <Text style={styles.error}>{error}</Text> : null}
              {showTerminal ? (
                <View style={styles.terminal}>
                  <Text style={styles.terminalText}>
                    {status === 'expired' ? 'Request expired' : 'Already accepted by another driver'}
                  </Text>
                </View>
              ) : null}

              {/* Actions (never staggered -- reaction time matters) */}
              {showActions ? (
                <View style={styles.actions}>
                  <Pressable
                    onPress={reject}
                    disabled={isAccepting}
                    accessibilityRole="button"
                    accessibilityLabel={`Decline ride request, ${secondsLeft} seconds remaining`}
                    style={({ pressed }) => [styles.decline, pressed && !isAccepting ? styles.pressed : null]}
                  >
                    <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
                      <Circle cx={RING / 2} cy={RING / 2} r={RING_R} stroke={colors.border} strokeWidth={RING_STROKE} fill="none" />
                      <AnimatedCircle
                        cx={RING / 2}
                        cy={RING / 2}
                        r={RING_R}
                        stroke={ringColor}
                        strokeWidth={RING_STROKE}
                        fill="none"
                        strokeDasharray="100 100"
                        strokeLinecap="round"
                        rotation={-90}
                        origin={`${RING / 2}, ${RING / 2}`}
                        animatedProps={ringProps}
                        {...({ pathLength: 100 } as { pathLength?: number })}
                      />
                    </Svg>
                    <Feather name="x" size={24} color={colors.ink900} />
                  </Pressable>

                  <Pressable
                    onPress={() => void handleAccept()}
                    disabled={isAccepting || accepted}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isAccepting || accepted }}
                    accessibilityLabel={`Accept ride, ${secondsLeft} seconds remaining`}
                    style={({ pressed }) => [styles.acceptWrap, pressed && !isAccepting ? styles.pressed : null]}
                  >
                    <LinearGradient
                      colors={accepted ? ['#2FCB8B', '#1B9A66'] : ['#14ABBD', '#0E8FA3']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.accept}
                    >
                      {accepted ? <Feather name="check" size={22} color={colors.inkInverse} /> : null}
                      <Text style={styles.acceptLabel}>{accepted ? 'Accepted' : 'Accept'}</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrim: { backgroundColor: 'rgba(7,20,23,0.58)' },
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  band: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg - 2 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginTop: spacing.sm + 2, marginBottom: spacing.md, backgroundColor: 'rgba(255,255,255,0.4)' },
  bandInner: { gap: 2 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.sm },
  fareRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  fare: { fontFamily: fonts.bold, fontSize: 48, lineHeight: 56, letterSpacing: -1.2, color: colors.inkInverse, fontVariant: ['tabular-nums'] },
  pay: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, color: 'rgba(255,255,255,0.92)' },
  fareNote: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.82)' },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },
  route: { flexDirection: 'row', gap: spacing.md },
  rail: { alignItems: 'center', width: 14, paddingTop: 30, paddingBottom: 30 },
  dotPickup: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary, borderWidth: 3, borderColor: colors.primarySubtle },
  railLine: { width: 2, flex: 1, marginVertical: 5, borderRadius: 1, backgroundColor: colors.border },
  dotDrop: { width: 12, height: 12, borderRadius: 3, backgroundColor: colors.ink900 },
  legs: { flex: 1, minWidth: 0 },
  leg: { gap: 2 },
  legHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md },
  legLabel: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.ink600 },
  legMetric: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, color: colors.ink900, fontVariant: ['tabular-nums'] },
  legDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
  place: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, color: colors.ink900 },
  placeRest: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink600 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, backgroundColor: colors.primarySubtle, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: spacing.md },
  factText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.ink900 },
  error: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.error, textAlign: 'center' },
  terminal: { paddingVertical: spacing.sm },
  terminalText: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, color: colors.ink900, textAlign: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  decline: { width: RING, height: RING, borderRadius: RING / 2, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.92 },
  acceptWrap: { flex: 1, height: RING, borderRadius: radii.full, boxShadow: '0 10px 22px rgba(14,143,163,0.34)' },
  accept: { flex: 1, borderRadius: radii.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  acceptLabel: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 24, color: colors.inkInverse },
})
