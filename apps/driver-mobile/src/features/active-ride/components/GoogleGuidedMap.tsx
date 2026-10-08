import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import {
  NavigationProvider,
  NavigationView,
  useNavigation,
  NavigationSessionStatus,
  TaskRemovedBehavior,
  TravelMode,
  type ArrivalEvent,
} from '@googlemaps/react-native-navigation-sdk'
import { colors, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import { markStopArrived, markStopStatus } from '../api'

export type GuidedStop = { sequence: number; lat: number; lng: number }

// Height of the control strip under the nav view (excluding the bottom safe-area inset).
// Exported so the screen can dock its SOS button inside it.
export const GUIDED_CONTROLS_HEIGHT = 76
const CONTROLS_HEIGHT = GUIDED_CONTROLS_HEIGHT

export type GoogleGuidedMapProps = {
  rideId: string
  destination: [number, number] | null
  /** Pending stops, in sequence order -- routed through before the destination waypoint. */
  stops?: GuidedStop[]
  /** One-way: arrival at a stop starts the wait clock and returns to the stop card. */
  meterWait?: boolean
  /** Fires once guidance reaches the final destination, or the driver taps "Close guidance".
      The caller reverts to the DIY map view -- this component never decides what's next. */
  onClose: () => void
  /** Fires after a non-final stop is auto-marked reached server-side, so the caller can
      refetch ride.stops (same contract as StopCard's onResolved). */
  onStopResolved?: () => void
}

// Inner component so useNavigation() has a NavigationProvider ancestor -- the provider
// itself can't also be the thing calling the hook.
function GuidedMapInner({ rideId, destination, stops = [], meterWait = false, onClose, onStopResolved }: GoogleGuidedMapProps) {
  const { navigationController, setOnArrival, removeAllListeners } = useNavigation()
  const [status, setStatus] = useState<'initializing' | 'ready' | 'failed'>('initializing')
  const resolvingStop = useRef(false)
  const insets = useSafeAreaInsets()
  // The arrival handler and init effect below only re-run on destination change,
  // so they would otherwise close over the stops from first mount: after the
  // first stop resolved, arrival at stop 2 re-marked stop 1 (409, swallowed) and
  // stop 2 stayed pending. Read through a ref instead.
  const stopsRef = useRef(stops)
  stopsRef.current = stops
  const navReady = useRef(false)
  const knownSeqs = useRef(new Set(stops.map((s) => s.sequence)))

  const handleClose = useCallback(() => {
    navigationController.stopGuidance().catch(() => {})
    onClose()
  }, [navigationController, onClose])

  useEffect(() => {
    let cancelled = false

    setOnArrival(async (event: ArrivalEvent) => {
      if (event.isFinalDestination) {
        await navigationController.stopGuidance().catch(() => {})
        onClose()
        return
      }
      // GPS jitter can re-fire onArrival for a stop already resolved -- same
      // idempotency guard as web's handleStopArrived (TripInProgress.tsx).
      if (resolvingStop.current) return
      resolvingStop.current = true
      const stop = stopsRef.current[0]
      if (meterWait && stop) {
        // One-way wait is billed from arrival: stamp it, then hand back to the
        // stop card (with its wait timer) instead of auto-continuing.
        try {
          await markStopArrived(rideId, stop.sequence)
          onStopResolved?.()
        } catch { /* driver can still tap "I've arrived" on the stop card */ }
        // resolvingStop stays true: guidance is closing, so a jittery re-fire must no-op.
        await navigationController.stopGuidance().catch(() => {})
        onClose()
        return
      }
      try {
        if (stop) await markStopStatus(rideId, stop.sequence, 'reached')
        onStopResolved?.()
      } catch {
        // stays pending server-side; driver can still use "Mark stop reached" in the DIY view
      } finally {
        resolvingStop.current = false
      }
      // The awaits above can outlive the screen (closed/unmounted/re-initialised) --
      // don't resurrect guidance with no UI attached.
      if (cancelled) return
      await navigationController.continueToNextDestination().catch(() => {})
      if (cancelled) return
      await navigationController.startGuidance().catch(() => {})
    })

    async function init() {
      if (!destination) return
      const accepted = await navigationController.showTermsAndConditionsDialog().catch(() => false)
      if (!accepted || cancelled) return
      const sessionStatus = await navigationController.init().catch(() => null)
      if (cancelled) return
      if (sessionStatus !== NavigationSessionStatus.OK) {
        setStatus('failed')
        return
      }
      const waypoints = [
        ...stopsRef.current.map((s) => ({ position: { lat: s.lat, lng: s.lng } })),
        { position: { lat: destination[0], lng: destination[1] } },
      ]
      try {
        await navigationController.setDestinations(waypoints, {
          routingOptions: { travelMode: TravelMode.DRIVING, avoidFerries: false, avoidTolls: false },
        })
        await navigationController.startGuidance()
        navReady.current = true
        if (!cancelled) setStatus('ready')
      } catch {
        if (!cancelled) setStatus('failed')
      }
    }
    void init()

    return () => {
      cancelled = true
      removeAllListeners()
      // removeAllListeners only drops JS callbacks. Without cleanup() the native navigator
      // keeps guiding and its foreground notification (which has no stop action) stays up
      // after the ride ends, the screen unmounts, or init half-fails. Rejects if init never
      // succeeded -- nothing to tear down then.
      navigationController.cleanup().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-init only on ride/destination identity, not stops array reference
  }, [rideId, destination?.[0], destination?.[1]])

  // A stop the rider adds while guidance is running: re-route through it. Only a
  // never-seen sequence triggers this -- a stop resolving (removed from `stops`)
  // is already handled by the arrival handler's continueToNextDestination.
  useEffect(() => {
    const added = stops.some((s) => !knownSeqs.current.has(s.sequence))
    stops.forEach((s) => knownSeqs.current.add(s.sequence))
    if (!added || !navReady.current || !destination) return
    const waypoints = [
      ...stops.map((s) => ({ position: { lat: s.lat, lng: s.lng } })),
      { position: { lat: destination[0], lng: destination[1] } },
    ]
    void navigationController
      .setDestinations(waypoints, {
        routingOptions: { travelMode: TravelMode.DRIVING, avoidFerries: false, avoidTolls: false },
      })
      .then(() => navigationController.startGuidance())
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the stops list only
  }, [stops])

  // Init failure (no network, quota exhausted, region unsupported) -- fall back to the
  // DIY view rather than leaving the driver on a blank/broken guided screen. Matches the
  // plan's "silently fall back to diy" decision (driver-mobile-nav-mode-design.md).
  useEffect(() => {
    if (status === 'failed') onClose()
  }, [status, onClose])

  return (
    // Native nav UI (turn banner, ETA card) ignores mapPadding and draws edge-to-edge, so the
    // view itself is inset: below the status bar/notch, above a dedicated control strip that
    // sits clear of the system nav bar. The strip holds Close (left) and leaves room for the
    // screen's SOS button (right) -- nothing floats over the SDK's own UI.
    <View style={[StyleSheet.absoluteFill, styles.root, { paddingTop: insets.top }]}>
      <NavigationView style={styles.nav} />
      <View style={[styles.controls, { height: CONTROLS_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]}>
        <Pressable
          onPress={handleClose}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel="Close guidance"
        >
          <Feather name="x" size={16} color={colors.inkInverse} />
          <Text style={styles.closeLabel}>Close guidance</Text>
        </Pressable>
      </View>
    </View>
  )
}

export function GoogleGuidedMap(props: GoogleGuidedMapProps) {
  return (
    <NavigationProvider
      termsAndConditionsDialogOptions={{
        title: 'Navigation Terms',
        companyName: 'Ocar',
        showOnlyDisclaimer: true,
      }}
      // QUIT_SERVICE: swiping the app away must kill guidance + its notification. CONTINUE_SERVICE
      // is for consumer nav; here the ride (and our own tracking service) owns the lifecycle.
      taskRemovedBehavior={TaskRemovedBehavior.QUIT_SERVICE}
    >
      <GuidedMapInner {...props} />
    </NavigationProvider>
  )
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.surface ?? '#fff' },
  nav: { flex: 1 },
  controls: {
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface ?? '#fff',
  },
  closeButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: 'rgba(20,23,26,0.85)',
  },
  closeLabel: { ...typography.label, color: colors.inkInverse, fontFamily: fonts.bold },
})
