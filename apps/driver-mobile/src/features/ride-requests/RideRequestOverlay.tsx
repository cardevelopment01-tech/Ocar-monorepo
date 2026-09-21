import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BackHandler, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { scheduleOnRN } from 'react-native-worklets'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { useRideRequestStore } from '@/store/useRideRequestStore'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { acceptRideRequest } from './api'
import { computeRemainingSeconds } from './countdown'
import { useRideAlertSound } from './useRideAlertSound'

const AnimatedPath = Animated.createAnimatedComponent(Path)

const WARNING_THRESHOLD_SECONDS = 5
const RING_STROKE = 4
const PAN_DISMISS_PX = 120
const PAN_DISMISS_VELOCITY = 850

// Named palette for this deliberate, dark, high-contrast "incoming call" moment --
// the ride request steals the whole screen so a phone in a car mount reads clearly
// in bright sunlight, exactly like the web driver app's TripRequestCard. Kept on
// Ocar's brand hues (driver teal + driver orange) so it never drifts off-brand.
const C = {
  surface: '#0F172A',
  surfaceDeep: '#0B1220',
  panel: '#1E293B',
  text: '#F8FAFC',
  textMuted: '#94A3B8',
  textFaint: '#64748B',
  divider: '#475569',
  primary: '#0A9FB0',
  primaryGlow: '#0A9FB0',
  accent: '#F97316',
  success: '#22C55E',
  error: '#EF4444',
  errorText: '#FCA5A5',
  warning: '#F59E0B',
  warningText: '#FDE68A',
  warningSub: '#B45309',
  info: '#38BDF8',
  infoSub: '#0369A1',
  violet: '#C084FC',
} as const

// Strong ease-out for everything that enters/exits, ease-in-out for in-frame
// movement (animate-expo tables -- never ease-in on UI).
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1)

// A rounded-rect outline for the countdown "ring" around the Accept button. Width
// is dynamic (the button fills the sheet), so we can't use a fixed SVG circle --
// a normalized path lets the stroke deplete like a timer no matter the width, which
// is what makes countdown + accept feel like a single object (as on the web app).
function roundedRectPath(w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2)
  return [
    `M ${rr} 0`,
    `H ${w - rr}`,
    `A ${rr} ${rr} 0 0 1 ${w} ${rr}`,
    `V ${h - rr}`,
    `A ${rr} ${rr} 0 0 1 ${w - rr} ${h}`,
    `H ${rr}`,
    `A ${rr} ${rr} 0 0 1 0 ${h - rr}`,
    `V ${rr}`,
    `A ${rr} ${rr} 0 0 1 ${rr} 0`,
    'Z',
  ].join(' ')
}

function NavigationIcon({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Path d="M3 11l19-9-9 19-2-8-8-2z" fill={color} />
    </Svg>
  )
}

function CheckIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M20 6L9 17l-5-5" />
    </Svg>
  )
}

function ClockIcon({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </Svg>
  )
}

function RefreshIcon({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M1 4v6h6" />
      <Path d="M23 20v-6h-6" />
      <Path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" />
    </Svg>
  )
}

type Resolved = 'accepted' | 'expired' | 'raceLost' | 'rejected'

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
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null)

  const dismissedRef = useRef(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // --- Motion state (all on the UI thread) -----------------------------------
  const sheetY = useSharedValue(0)
  const sheetOpacity = useSharedValue(1)
  const backdropOpacity = useSharedValue(0)
  const ringProgress = useSharedValue(1)
  const urgentPulse = useSharedValue(1)
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
    setFrame(null)

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
    urgentPulse.set(1)
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
    if (status === 'expired') schedule(() => animateOut(pending.rideId as string), 1200)
    if (status === 'raceLost') schedule(() => animateOut(pending.rideId as string), 1500)
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Android hardware back = reject (deliberate, distinct from in-ride screens).
  useEffect(() => {
    if (!pending) return
    const sub = BackHandler.addEventListener('hardwareBackPress', handleBack)
    return () => sub.remove()
  }, [pending, handleBack])

  // Urgency: under 5s the accept ring gently pulses. Skipped under reduced motion.
  useEffect(() => {
    if (reduced) return
    if (isUrgent) {
      urgentPulse.set(withRepeat(withTiming(1.05, { duration: 520, easing: EASE_IN_OUT }), -1, true))
    } else {
      urgentPulse.set(1)
    }
  }, [isUrgent, reduced]) // eslint-disable-line react-hooks/exhaustive-deps

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
      // Success beat + a single confirmation haptic (the visual leads).
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
  const acceptScale = useAnimatedStyle(() => ({ transform: [{ scale: urgentPulse.get() }] }))
  const ringProps = useAnimatedProps(() => {
    const fraction = ringProgress.get() // 1 -> 0 remaining
    return { strokeDashoffset: (1 - fraction) * 100 }
  })

  // Staggered entrance for the info blocks -- never the Accept row, which must be
  // tappable the instant it lands (don't shrink the real reaction window).
  const entrances = useMemo(() => {
    const mk = (i: number) =>
      reduced
        ? FadeIn.duration(140).delay(i * 30)
        : FadeInDown.duration(240).delay(70 + i * 42).withInitialValues({ transform: [{ translateY: 12 }] })
    return [mk(0), mk(1), mk(2), mk(3)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId, reduced])

  if (!pending) return null

  const km = pending.distanceToPickup / 1000
  const etaMin = km > 0 ? Math.max(1, Math.round(km / 0.6)) : 0
  const secondsLeft = Math.max(0, seconds)
  const isReturn = pending.isReturnCab || pending.rideType === 'round_trip'
  const isRental = pending.rideType === 'rental'
  const stopCount = pending.stopCount ?? 0
  const returnAtFormatted = pending.returnAt
    ? new Date(pending.returnAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    : null

  const title = isReturn ? 'Round trip' : isRental ? 'Rental request' : 'Trip request'
  const ringColor = isUrgent ? C.error : isReturn ? C.warning : isRental ? C.info : C.primary

  const showActions = status === 'show'
  const showTerminal = status === 'expired' || status === 'raceLost'

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={handleBack}>
      <View style={styles.root}>
        {/* Deep brand scrim -- an "incoming call" moment, dark + focused. */}
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <LinearGradient
            colors={[C.surfaceDeep, C.surface]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={['rgba(10,159,176,0.22)', 'rgba(10,159,176,0)']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 0.8 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.sheetWrap, sheetStyle]}>
            {/* Modal draws edge-to-edge (edgeToEdgeEnabled, gradle.properties) --
                a fixed bottom padding here left Accept/Decline sitting right at
                or behind a 3-button nav bar; this is the real safe-area inset. */}
            <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.xl + 12) }]}>
              <View style={styles.handleRow}>
                <View style={styles.handle} />
              </View>

              {/* Header: eyebrow + title + badges */}
              <Animated.View entering={entrances[0]}>
                <View style={styles.eyebrowRow}>
                  <View style={styles.pulseDot} />
                  <Text style={styles.eyebrow}>New ride request</Text>
                </View>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{title}</Text>
                  {isReturn ? <Badge bg="rgba(245,158,11,0.16)" color={C.warning}>Return</Badge> : null}
                  {isRental ? <Badge bg="rgba(56,189,248,0.14)" color={C.info}>Rental</Badge> : null}
                  {stopCount > 0 ? <Badge bg="rgba(192,132,252,0.16)" color={C.violet}>{stopCount === 1 ? '1 stop' : `${stopCount} stops`}</Badge> : null}
                </View>
              </Animated.View>

              {/* ETA to pickup -- the #1 accept factor */}
              <Animated.View entering={entrances[1]}>
                <View style={styles.etaRow}>
                  <NavigationIcon color={C.accent} />
                  <Text style={styles.etaStrong}>{etaMin} min</Text>
                  <Text style={styles.etaMuted}>· {formatKm(km)} away</Text>
                </View>
              </Animated.View>

              {/* Fare hero */}
              <Animated.View entering={entrances[2]}>
                <View style={styles.fareRow}>
                  <Text style={styles.fare}>₹{pending.estimatedFare}</Text>
                  <Text style={styles.fareMeta}>estimate</Text>
                </View>
              </Animated.View>

              {/* Route panel: rail + pickup/drop */}
              <Animated.View entering={entrances[3]}>
                <View style={styles.routePanel}>
                  <View style={styles.rail}>
                    <View style={styles.railDotPickup} />
                    <View style={styles.railLine} />
                    <View style={styles.railDotDrop} />
                  </View>
                  <View style={styles.routeTexts}>
                    <View style={styles.routeRow}>
                      <Text style={styles.routeLabel}>Pickup</Text>
                      <Text style={styles.routeAddress} numberOfLines={2}>{pending.pickup}</Text>
                    </View>
                    <View style={styles.routeRow}>
                      <Text style={styles.routeLabel}>{isRental ? 'Flexible route' : isReturn ? 'Drop · return' : 'Drop'}</Text>
                      <Text style={[styles.routeAddress, isRental && { color: C.info }]} numberOfLines={2}>
                        {isRental ? 'Hourly rental' : pending.drop}
                      </Text>
                    </View>
                  </View>
                </View>
              </Animated.View>

              {/* Ride-type disclosure band, round trip / rental only */}
              {(isReturn || isRental) && (
                <View style={styles.block}>
                  {isReturn ? (
                    <View style={[styles.disclosure, { backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.24)' }]}>
                      <RefreshIcon color={C.warning} />
                      <View style={styles.disclosureTexts}>
                        <Text style={[styles.disclosureTitle, { color: C.warningText }]}>Outstation return trip</Text>
                        <Text style={[styles.disclosureBody, { color: C.warningSub }]}>
                          {returnAtFormatted ? `Must return by ${returnAtFormatted}` : 'You must drive back to the pickup point'}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View style={[styles.disclosure, { backgroundColor: 'rgba(56,189,248,0.10)', borderColor: 'rgba(56,189,248,0.2)' }]}>
                      <ClockIcon color={C.info} />
                      <View style={styles.disclosureTexts}>
                        <Text style={[styles.disclosureTitle, { color: C.info }]}>
                          {pending.tripHours ? `${pending.tripHours}-hour rental` : 'Hourly rental'}
                        </Text>
                        <Text style={[styles.disclosureBody, { color: C.infoSub }]}>Stay with the passenger for the full duration</Text>
                      </View>
                    </View>
                  )}
                </View>
              )}

              {/* Error / terminal message */}
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
                    accessibilityLabel="Decline ride request"
                    style={({ pressed }) => [styles.decline, pressed && !isAccepting ? styles.pressed : null]}
                  >
                    <Text style={styles.declineText}>Decline</Text>
                  </Pressable>

                  <View
                    style={styles.acceptFrame}
                    onLayout={(e) => {
                      const { width: w, height: h } = e.nativeEvent.layout
                      setFrame({ w, h })
                    }}
                  >
                    <Animated.View style={[StyleSheet.absoluteFill, acceptScale]}>
                      {frame && (
                        <Svg width={frame.w} height={frame.h} style={StyleSheet.absoluteFill}>
                          <AnimatedPath
                            d={roundedRectPath(frame.w, frame.h, 16)}
                            stroke={accepted ? C.success : ringColor}
                            strokeWidth={RING_STROKE}
                            fill="none"
                            strokeDasharray="100 100"
                            strokeLinecap="round"
                            animatedProps={ringProps}
                            // pathLength is a real, valid SVG attribute react-native-svg
                            // supports at runtime, but Reanimated's createAnimatedComponent
                            // wrapper type doesn't include it in either of its two Path
                            // prop overloads -- spread a narrowly-typed object rather than
                            // widening the whole component to `any`.
                            {...({ pathLength: 100 } as { pathLength?: number })}
                          />
                        </Svg>
                      )}
                    </Animated.View>
                    <Pressable
                      onPress={() => void handleAccept()}
                      disabled={isAccepting || accepted}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: isAccepting || accepted }}
                      accessibilityLabel={`Accept ride, ${secondsLeft} seconds remaining`}
                      style={({ pressed }) => [pressed && !isAccepting ? styles.pressed : null]}
                    >
                      <LinearGradient
                        colors={accepted ? ['#16A34A', '#15803D'] : [colors.primary, '#0A7F8C']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.accept}
                      >
                        {accepted ? (
                          <View style={styles.acceptLabelRow}>
                            <CheckIcon color={C.text} />
                            <Text style={styles.acceptLabel}>Accepted</Text>
                          </View>
                        ) : (
                          <View style={styles.acceptLabelRow}>
                            <CheckIcon color={C.text} />
                            <Text style={styles.acceptLabel}>Accept · ₹{pending.estimatedFare}</Text>
                            <View style={[styles.secondsPill, isUrgent && { backgroundColor: 'rgba(239,68,68,0.22)' }]}>
                              <Text style={[styles.secondsPillText, isUrgent && { color: C.errorText }]}>{secondsLeft}s</Text>
                            </View>
                          </View>
                        )}
                      </LinearGradient>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  )
}

function Badge({ children, bg, color }: { children: string; bg: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color }]}>{children}</Text>
    </View>
  )
}

function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(1)} km`
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.surface,
    borderTopLeftRadius: radii['3xl'],
    borderTopRightRadius: radii['3xl'],
    overflow: 'hidden',
  },
  sheet: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  handleRow: { alignItems: 'center', paddingTop: spacing.sm + 2, paddingBottom: spacing.xs },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(248,250,252,0.16)' },
  block: {},
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primaryGlow },
  eyebrow: {
    ...typography.caption,
    color: C.primaryGlow,
    letterSpacing: 1.4,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs, flexWrap: 'wrap' },
  title: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 20, lineHeight: 26, color: C.text },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.full, marginLeft: 2 },
  badgeText: { fontSize: 10, fontWeight: '800' },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  etaStrong: { ...typography.label, color: C.text, fontWeight: '700', fontSize: 15 },
  etaMuted: { ...typography.label, color: C.textMuted, fontFamily: 'PlusJakartaSans_500Medium' },
  fareRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  fare: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 34, lineHeight: 38, letterSpacing: -1.2, color: C.text },
  fareMeta: { ...typography.caption, color: C.textFaint, fontWeight: '600' },
  routePanel: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: C.panel,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  rail: { alignItems: 'center', width: 10, paddingTop: 4 },
  railDotPickup: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.text },
  railLine: { width: 2, flex: 1, marginVertical: 4, borderRadius: 1, backgroundColor: C.divider },
  railDotDrop: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },
  routeTexts: { flex: 1, gap: spacing.lg, paddingTop: 2 },
  routeRow: { gap: 2 },
  routeLabel: { ...typography.caption, color: C.textFaint, textTransform: 'uppercase', letterSpacing: 0.6 },
  routeAddress: { ...typography.body, color: C.text, fontWeight: '600', fontSize: 15, lineHeight: 22 },
  disclosure: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', borderRadius: radii.md, borderWidth: 1, padding: spacing.sm + 2 },
  disclosureTexts: { flex: 1, gap: 2 },
  disclosureTitle: { ...typography.label, fontWeight: '700', fontSize: 13 },
  disclosureBody: { ...typography.caption, fontSize: 12, lineHeight: 16 },
  error: { ...typography.label, color: C.error, textAlign: 'center', marginTop: spacing.xs },
  terminal: { paddingVertical: spacing.sm },
  terminalText: { ...typography.title, color: C.text, textAlign: 'center', fontWeight: '700' },
  actions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  decline: {
    width: 108,
    height: 58,
    borderRadius: radii.lg,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineText: { ...typography.label, color: C.textMuted, fontWeight: '600', fontSize: 15 },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.92 },
  acceptFrame: { flex: 1, height: 58, justifyContent: 'center' },
  accept: { flex: 1, margin: RING_STROKE, borderRadius: radii.lg - 2, alignItems: 'center', justifyContent: 'center' },
  acceptLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center' },
  acceptLabel: { ...typography.title, color: C.text, fontWeight: '700', fontSize: 15 },
  secondsPill: {
    backgroundColor: 'rgba(248,250,252,0.12)',
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    minWidth: 34,
    alignItems: 'center',
  },
  secondsPillText: { color: C.text, fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, fontVariant: ['tabular-nums'] },
})
