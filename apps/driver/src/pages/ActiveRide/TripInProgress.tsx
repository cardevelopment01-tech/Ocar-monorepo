import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, X, RotateCcw, Flag, CheckCircle2, Navigation, Locate, Check, LocateOff, AlertTriangle } from 'lucide-react'
import {
  motion, AnimatePresence, useReducedMotion,
  useMotionValue, useTransform, useMotionValueEvent, animate,
} from 'framer-motion'
import SOSButton from '@/components/ui/SOSButton'
import OtpVerifyPanel from '@/components/ui/OtpVerifyPanel'
import VoiceToggleButton from '@/components/ui/VoiceToggleButton'
import HindiVoiceHint from '@/components/ui/HindiVoiceHint'
import ManeuverBanner from '@/components/map/ManeuverBanner'
import { useRideStore } from '@/store/useRideStore'
import SwipeToConfirm from '@/components/ui/SwipeToConfirm'
import { useSessionStore } from '@/store/useSessionStore'
import { useNavPrefsStore } from '@/store/useNavPrefsStore'
import { driverRideApi } from '@/lib/ride-api'
import { driverSafetyApi } from '@/lib/safety-api'
import { openMapsNav } from '@/lib/utils'
import { getDriverSocket } from '@/lib/socket'
import { EASE, GLASS, fmtReturn } from '@/lib/constants'
import { useDriverLocation } from '@/lib/useDriverLocation'
import { useTurnByTurn } from '@/lib/useTurnByTurn'
import { useVoiceGuidance } from '@/lib/useVoiceGuidance'
import { useSpeedAlert } from '@/lib/useSpeedAlert'
import { classifyLimit, HIGHWAY_SPEED_LIMIT_KMPH, type SpeedLimitCity } from '@/lib/speedLimit'
import api from '@/lib/api'
import { useWakeLock } from '@/lib/useWakeLock'
import { haversineMetres, remainingRoutePath } from '@/lib/geo'

const DriverMapView     = lazy(() => import('@/components/map/DriverMapView'))
const RecenterMap       = lazy(() => import('@/components/map/RecenterMap'))
const LocationPin       = lazy(() => import('@/components/map/LocationPin'))
const SelfCarMarker     = lazy(() => import('@/components/map/SelfCarMarker'))
const RoutePolyline     = lazy(() => import('@/components/map/RoutePolyline'))
const TrafficLayer      = lazy(() => import('@/components/map/TrafficLayer'))
const TrafficColoredRoute = lazy(() => import('@/components/map/TrafficColoredRoute'))
const FitBoundsToPoints = lazy(() => import('@/components/map/FitBoundsToPoints'))

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245
// "Here's the journey" beat on trip start, shorter "here's the next leg" beat
// on each stop advance — see docs/DRIVER_TRIP_UX_REDESIGN_PLAN.md §4.
const OVERVIEW_BEAT_MS = 1200
const MINI_BEAT_MS = 800
// Larger than the pickup radius (75m) — highways near drop points make a
// tight radius unreliable.
const ARRIVAL_RADIUS_METRES = 150
// Free wait window per stop before wait is billed (one-way). Mirror of the API's
// STOP_FREE_WAIT_MINUTES — the server is authoritative on the actual charge.
const STOP_FREE_WAIT_SECONDS = 10 * 60

function fmtClock(totalSec: number) {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function useElapsed(startedAt?: string) {
  const initial = startedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000)) : 0
  const [seconds, setSeconds] = useState(initial)
  useEffect(() => {
    const id = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function TripInProgress() {
  const navigate = useNavigate()
  const { activeRide, updateRideStatus, updateStop, arriveStop, setFare } = useRideStore()
  const elapsed = useElapsed(activeRide?.rideStartedAt)
  const { sessionId } = useSessionStore()

  const reduceMotion = useReducedMotion()
  const [showEndOtp, setShowEndOtp] = useState(false)
  const [otp, setOtp]               = useState('')
  const [otpError, setOtpError]     = useState(false)
  const [stopActionPending, setStopActionPending] = useState<number | null>(null)
  const [showEndEarlySheet, setShowEndEarlySheet] = useState(false)
  const [endEarlyReason,    setEndEarlyReason]    = useState<string | null>(null)
  const [endingEarly,       setEndingEarly]       = useState(false)
  const [endEarlyError,     setEndEarlyError]     = useState<string | null>(null)

  // ── Collapsible bottom sheet (mirrors NavigateToPickup.tsx — see
  //    docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 8): "Complete Trip" sits
  //    above the collapse anchor so it's never hidden; stop itinerary/fare
  //    details fade away to reveal more map. ──
  const sheetRef      = useRef<HTMLDivElement | null>(null)
  const contentRef    = useRef<HTMLDivElement | null>(null)
  const collapseRef   = useRef<HTMLDivElement | null>(null)
  const dragRef       = useRef<{ startY: number; startH: number } | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const animRef       = useRef<any>(null)
  const rafRef        = useRef<number | null>(null)

  // Starts large so no content clips before the first ResizeObserver
  // measurement fires (matches Home.tsx's own drag-sheet).
  const sheetH        = useMotionValue(700)
  const handlePressed = useMotionValue(0)
  const [maxContentH, setMaxContentH] = useState(700)
  const [collapsedH,  setCollapsedH]  = useState(140)
  const [occlusion,   setOcclusion]   = useState(700)

  const snaps = useMemo(() => ({ collapsed: collapsedH, peek: maxContentH }), [collapsedH, maxContentH])
  const handleScaleX = useTransform(handlePressed, [0, 1], [1, 1.65])
  const handleBg     = useTransform(handlePressed, [0, 1], ['rgba(10, 159, 176,0.15)', 'rgba(10, 159, 176,0.48)'])
  const belowFoldOpacity = useTransform(sheetH, [collapsedH, collapsedH + 56], [0, 1])

  useMotionValueEvent(sheetH, 'change', (h) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      setOcclusion(Math.round(h))
      rafRef.current = null
    })
  })

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const naturalH = Math.round(el.getBoundingClientRect().height)
      const anchorEl = collapseRef.current
      const sheetEl  = sheetRef.current
      if (anchorEl && sheetEl) {
        const sheetTop  = sheetEl.getBoundingClientRect().top
        const anchorTop = anchorEl.getBoundingClientRect().top
        const collapsed = Math.round(anchorTop - sheetTop) + 16
        setCollapsedH(Math.max(collapsed, 96))
      }
      setMaxContentH(naturalH)
      if (sheetH.get() > naturalH) {
        sheetH.set(naturalH)
        setOcclusion(naturalH)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [sheetH])

  function springTo(target: number) {
    const springOpts = reduceMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 380, damping: 38, mass: 1 }
    animRef.current = animate(sheetH, target, springOpts)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    void animRef.current.then(() => setOcclusion(target))
  }

  function onSheetPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    animRef.current?.stop()
    dragRef.current = { startY: e.clientY, startH: sheetH.get() }
    handlePressed.set(1)
  }
  function onSheetPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    const delta = dragRef.current.startY - e.clientY
    sheetH.set(Math.max(snaps.collapsed, Math.min(snaps.peek, dragRef.current.startH + delta)))
  }
  function onSheetPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    const moved = Math.abs(dragRef.current.startY - e.clientY)
    dragRef.current = null
    handlePressed.set(0)
    if (moved < 6) {
      springTo(sheetH.get() > (snaps.collapsed + snaps.peek) / 2 ? snaps.collapsed : snaps.peek)
      return
    }
    const velocity = sheetH.getVelocity()
    if (velocity > 180) springTo(snaps.peek)
    else if (velocity < -180) springTo(snaps.collapsed)
    else {
      const current = sheetH.get()
      springTo(Math.abs(current - snaps.collapsed) < Math.abs(current - snaps.peek) ? snaps.collapsed : snaps.peek)
    }
  }

  // Map mode system (see docs/DRIVER_TRIP_UX_REDESIGN_PLAN.md §1/§4).
  const [mapMode, setMapMode]     = useState<'overview' | 'nav'>('overview')
  const [following, setFollowing] = useState(true)
  const [resumeKey, setResumeKey] = useState(0)
  const [nearTarget, setNearTarget] = useState(false)
  const announcedFor = useRef<string | null>(null)
  const isFirstBeat  = useRef(true)

  function handleRecenter() { setResumeKey(k => k + 1) }
  // Resync on resume is handled by RecenterMap's `suspended` prop itself —
  // no need to also bump resumeKey here.

  // One leg at a time, matching how Uber drivers actually navigate — multi-waypoint
  // deep links are flaky on Android. currentStop advances after each reached/skipped.
  const stops = activeRide?.stops ?? []
  const currentStop = stops.find(s => s.status === 'pending') ?? null
  const accruedWaitCharge = stops.reduce((sum, s) => sum + parseFloat(s.wait_charge ?? '0'), 0)

  const dropPos: [number, number] = currentStop
    ? [currentStop.lat, currentStop.lng]
    : [activeRide?.dropLat ?? DEFAULT_LAT, activeRide?.dropLng ?? DEFAULT_LNG]

  async function handleStopAction(sequence: number, status: 'reached' | 'skipped') {
    if (!activeRide || stopActionPending !== null) return
    setStopActionPending(sequence)
    try {
      const res = await driverRideApi.markStopStatus(activeRide.id, sequence, status)
      updateStop(sequence, status, res.stop.reached_at, res.stop.wait_charge)
    } catch { /* stays pending, driver can retry */ } finally {
      setStopActionPending(null)
    }
  }

  // One-way meters wait at a stop: the driver taps Arrive (starts the server-side
  // clock), then Continue (server bills wait beyond the free window). Round-trip
  // and rental skip this entirely — their wait is inside the hours package.
  const isOneWay = activeRide?.rideType === 'one_way'
  const waitingStop = isOneWay
    ? stops.find(s => s.status === 'pending' && s.arrived_at != null) ?? null
    : null

  async function handleStopArrived(sequence: number) {
    if (!activeRide || stopActionPending !== null) return
    setStopActionPending(sequence)
    try {
      const res = await driverRideApi.markStopStatus(activeRide.id, sequence, 'arrived')
      arriveStop(sequence, res.stop.arrived_at, res.stop.wait_charge)
    } catch { /* stays pending, driver can retry */ } finally {
      setStopActionPending(null)
    }
  }

  // Live wait clock, only ticking while a stop is being waited at.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!waitingStop) return
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [waitingStop?.sequence, waitingStop?.arrived_at])

  const waitElapsedSec = waitingStop?.arrived_at
    ? Math.max(0, Math.floor((nowMs - Date.parse(waitingStop.arrived_at)) / 1000))
    : 0
  const waitFreeLeftSec = Math.max(0, STOP_FREE_WAIT_SECONDS - waitElapsedSec)

  const { position, heading: selfHeading, speedKmph, error: gpsError } = useDriverLocation({
    highAccuracy: true,
    syncIntervalMs: 3_000,
    onSync: sessionId
      ? (lat, lng, heading) => {
          // Over the already-open socket instead of a fresh HTTP request every 3s.
          getDriverSocket().emit('location:update', { sessionId, lat, lng, heading, recordedAt: new Date().toISOString() })
        }
      : undefined,
  })
  useWakeLock()

  // Nav target is the current pending stop when one exists, else the final drop —
  // the hook refetches automatically whenever this destination identity changes,
  // e.g. when the driver marks a stop reached/skipped. A rental with a rider-
  // selected drop-off has a real dropLat/dropLng just like any other ride and gets
  // full turn-by-turn — Phase 10a's original "rentals never have a committed
  // destination" premise was wrong (reverted 2026-07-13, see Phase 10a-revert)
  // and had been suppressing navigation for rentals that DO have a real drop.
  const hasNavTarget = currentStop != null || (activeRide?.dropLat != null && activeRide?.dropLng != null)
  const voiceEnabled = useNavPrefsStore(s => s.voiceEnabled)
  const navLanguage  = useNavPrefsStore(s => s.language)

  const { encodedPolyline, trafficIntervals, trafficPolyline, source, currentStep, distanceToManeuver, isReconnecting, snappedPosition, snappedHeading, snappedSegmentIndex, routePoints } =
    useTurnByTurn(position, hasNavTarget ? dropPos : null, navLanguage, selfHeading)

  // Prefer the route-snapped fix over raw GPS for anything rendered on the map —
  // see the matching comment in NavigateToPickup.tsx. Arrival/distance checks
  // below deliberately keep using raw `position`.
  const displayPosition = snappedPosition ?? position
  const displayHeading  = snappedHeading ?? selfHeading
  // Trim the drawn route to what's still ahead of the last on-route snap —
  // see docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 7b. Undefined (falls back to
  // the full route) whenever there's no snap yet. Must use the hook's own
  // `routePoints` here, not a separate decode of `encodedPolyline` — see that
  // field's doc comment for why mixing the two draws a straight line.
  const remainingPath = useMemo<[number, number][] | undefined>(() => {
    if (snappedSegmentIndex == null || !snappedPosition || routePoints.length === 0) return undefined
    return remainingRoutePath(snappedPosition, routePoints, snappedSegmentIndex, dropPos)
  }, [snappedSegmentIndex, snappedPosition, routePoints, dropPos])
  // Fall back to drop only for map centering, never for the car marker or route fetch.
  // Without this guard, the car appears AT the drop pin before GPS resolves, making
  // it look like the driver has already reached the destination.
  const mapCenter: [number, number] = displayPosition ?? dropPos
  useVoiceGuidance(currentStep, distanceToManeuver, voiceEnabled, navLanguage)

  // Over-speed voice alert: classify the posted limit (city 50 / highway 70) from
  // the driver's raw GPS position against the active city list, then let
  // useSpeedAlert fire a "slow down" voice cue when they hold above it.
  const [cities, setCities] = useState<SpeedLimitCity[]>([])
  useEffect(() => {
    api.get<SpeedLimitCity[]>('/api/v1/geo/cities').then(r => setCities(r.data ?? [])).catch(() => {})
  }, [])
  const limitKmph = position && cities.length
    ? classifyLimit(position, cities)
    : HIGHWAY_SPEED_LIMIT_KMPH
  useSpeedAlert(speedKmph, limitKmph, voiceEnabled, navLanguage)

  // "Here's the journey" beat on mount (trip just started), "here's the next
  // leg" mini-beat whenever the nav target changes (a stop is reached/skipped
  // and useTurnByTurn's destination — and therefore this key — changes).
  const destKey = hasNavTarget ? `${dropPos[0].toFixed(5)},${dropPos[1].toFixed(5)}` : null
  const prevDestKey = useRef<string | null>(null)
  useEffect(() => {
    if (destKey === null) {
      // Free-drive (rental, no target): nothing to preview, skip straight to a
      // live-following camera instead of sitting suspended in 'overview' forever
      // (FitBoundsToPoints no-ops below 2 points, so 'overview' would otherwise
      // never move the camera at all — see Phase 10a).
      if (isFirstBeat.current) { isFirstBeat.current = false; setMapMode('nav') }
      return
    }
    if (prevDestKey.current === destKey) return
    prevDestKey.current = destKey
    const holdMs = isFirstBeat.current ? OVERVIEW_BEAT_MS : MINI_BEAT_MS
    isFirstBeat.current = false
    setMapMode('overview')
    const t = setTimeout(() => setMapMode('nav'), holdMs)
    return () => clearTimeout(t)
  }, [destKey])

  // Arrival micro-state, shared rule for "next stop" and "final drop" — both
  // are just `dropPos` at any given moment. Manual confirmation still
  // required (Reached / Complete Trip), this only relaxes the camera.
  useEffect(() => {
    if (!position || !hasNavTarget) { setNearTarget(false); return }
    setNearTarget(haversineMetres(position, dropPos) <= ARRIVAL_RADIUS_METRES)
  }, [position, dropPos, hasNavTarget])

  useEffect(() => {
    if (!nearTarget || !voiceEnabled || !destKey || announcedFor.current === destKey) return
    announcedFor.current = destKey
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const label = currentStop ? `You have arrived at stop ${currentStop.sequence}.` : 'You have arrived at the destination.'
    const utterance = new SpeechSynthesisUtterance(label)
    utterance.lang = navLanguage === 'hi' ? 'hi-IN' : 'en-IN'
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearTarget, voiceEnabled, navLanguage, destKey])

  const handleSOS = async () => {
    await driverSafetyApi.triggerSos({
      rideId:   activeRide?.id ?? '',
      lat:      position?.[0],
      lng:      position?.[1],
      severity: 'high',
    })
  }

  const handleCompleteTrip = async () => {
    if (!activeRide) return
    try {
      let actualDistanceKm: number | undefined
      if (activeRide.dropLat != null && activeRide.dropLng != null) {
        const R = 6371
        const dLat = (activeRide.dropLat - activeRide.pickupLat) * Math.PI / 180
        const dLng = (activeRide.dropLng - activeRide.pickupLng) * Math.PI / 180
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(activeRide.pickupLat * Math.PI / 180) *
          Math.cos(activeRide.dropLat * Math.PI / 180) *
          Math.sin(dLng / 2) ** 2
        actualDistanceKm = Math.round(R * 2 * Math.asin(Math.sqrt(a)) * 1.3 * 10) / 10
      }
      const [mm, ss] = elapsed.split(':').map(Number)
      const actualDurationMin = mm + Math.round((ss ?? 0) / 60)
      const result = await driverRideApi.verifyEndOtp(activeRide.id, otp, actualDistanceKm, actualDurationMin || undefined, position?.[0], position?.[1])
      if (result.finalFare !== undefined) setFare(result.finalFare)
      updateRideStatus('completed')
    } catch {
      setOtpError(true)
      setOtp('')
      throw new Error('otp-verify-failed')
    }
  }

  const handleEndEarly = async () => {
    if (!activeRide || !endEarlyReason || endingEarly) return
    setEndingEarly(true)
    setEndEarlyError(null)
    try {
      const [curLat, curLng] = position ?? [activeRide.pickupLat, activeRide.pickupLng]
      const R = 6371
      const dLat = (curLat - activeRide.pickupLat) * Math.PI / 180
      const dLng = (curLng - activeRide.pickupLng) * Math.PI / 180
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(activeRide.pickupLat * Math.PI / 180) *
        Math.cos(curLat * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2
      const actualDistanceKm = Math.round(R * 2 * Math.asin(Math.sqrt(a)) * 1.3 * 10) / 10
      const [mm, ss] = elapsed.split(':').map(Number)
      const actualDurationMin = Math.max(1, mm + Math.round((ss ?? 0) / 60))

      const result = await driverRideApi.endRideEarly(activeRide.id, endEarlyReason, actualDistanceKm, actualDurationMin)
      if (result.finalFare !== undefined) setFare(result.finalFare)
      updateRideStatus('completed')
      navigate(activeRide.paymentChannel === 'cash' ? '/ride/collect-cash' : '/ride/end', { replace: true })
    } catch {
      setEndEarlyError('Could not end the trip. Check your connection and try again.')
      setEndingEarly(false)
    }
  }

  // Single primary swipe for the whole screen — label/action depend on where
  // the driver actually is in the trip; never two live swipes shown at once
  // (see docs/superpowers/specs/2026-08-04-driver-trip-single-primary-cta-design.md).
  const primaryAction = currentStop
    ? (isOneWay && currentStop.arrived_at != null
        ? {
            key: `wait-${currentStop.sequence}`,
            label: 'Slide to start next leg',
            onConfirm: () => handleStopAction(currentStop.sequence, 'reached'),
          }
        : {
            key: `stop-${currentStop.sequence}`,
            label: isOneWay ? 'Slide to start wait clock' : `Slide to confirm stop ${currentStop.sequence}`,
            onConfirm: () => (isOneWay
              ? handleStopArrived(currentStop.sequence)
              : handleStopAction(currentStop.sequence, 'reached')),
          })
    : {
        key: 'complete-trip',
        label: 'Slide to complete trip',
        onConfirm: () => setShowEndOtp(true),
      }

  return (
    <div className="relative w-full h-[100dvh] bg-bg overflow-hidden">

      {/* Map */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <Suspense fallback={<div className="w-full h-full bg-surface animate-pulse" />}>
          <DriverMapView initialCenter={mapCenter} zoom={15}>
            <TrafficLayer />
            {mapMode === 'overview' && (
              <FitBoundsToPoints
                points={[position, hasNavTarget ? dropPos : null]}
                padding={{ top: 140, bottom: 260, left: 40, right: 40 }}
              />
            )}
            {/* Always mounted — see the matching comment in NavigateToPickup.tsx. */}
            <RecenterMap
              center={mapCenter}
              heading={displayHeading}
              topPadding={100}
              bottomPadding={occlusion + 20}
              // Flat (no tilt) to match the user app's map and avoid Google's
              // automatic 3D building extrusion — see the matching comment in
              // NavigateToPickup.tsx.
              pitch={0}
              distanceToManeuver={nearTarget ? 250 : distanceToManeuver}
              onFollowChange={setFollowing}
              resumeKey={resumeKey}
              suspended={mapMode === 'overview'}
            />
            {hasNavTarget && (
              <>
                {/* Static full-route backdrop the trimmed line shrinks against —
                    see remainingPath's doc comment / Phase 7b. */}
                <RoutePolyline encoded={encodedPolyline} variant="traveled-backdrop" />
                <RoutePolyline encoded={remainingPath ? undefined : encodedPolyline} positions={remainingPath} />
                <TrafficColoredRoute encoded={trafficPolyline} intervals={trafficIntervals} />
              </>
            )}
            {displayPosition && <SelfCarMarker position={displayPosition} />}
            {hasNavTarget && <LocationPin position={dropPos} variant="drop" />}
            {hasNavTarget && (
              <button
                aria-label="Open in Google Maps"
                style={{ position: 'absolute', left: 16, bottom: `calc(env(safe-area-inset-bottom) + ${occlusion + 64}px)`, zIndex: 5 }}
                className="w-12 h-12 rounded-2xl bg-surface border border-border shadow-lg flex items-center justify-center active:scale-95 transition-transform"
                onClick={() => openMapsNav(dropPos[0], dropPos[1])}
              >
                <Navigation size={20} className="text-primary" />
              </button>
            )}
          </DriverMapView>
        </Suspense>
      </div>

      {/* Top instruction card — floats with margin on all sides, fully rounded,
          Google Maps style. SOS floats bottom-right instead of sharing this zone. */}
      <div
        className="absolute top-0 left-0 right-0 px-4"
        style={{ zIndex: 10, paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}
      >
        <div className="rounded-3xl overflow-hidden" style={GLASS}>
          <AnimatePresence mode="wait">
            {nearTarget ? (
              <motion.div
                key="arrived-banner"
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center flex-shrink-0" aria-hidden>
                  <Check size={24} className="text-text-inverse" strokeWidth={2.5} />
                </div>
                <p className="text-text-primary font-bold text-sm truncate">
                  {currentStop ? `Arrived — Stop ${currentStop.sequence}` : 'Arrived at the destination'}
                </p>
              </motion.div>
            ) : (currentStep || isReconnecting || source !== 'google') && (
              <motion.div
                key="maneuver"
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3, ease: EASE }}
              >
                <ManeuverBanner step={currentStep} distanceMetres={distanceToManeuver} isReconnecting={isReconnecting} source={source} />
              </motion.div>
            )}
          </AnimatePresence>
          <div className="flex items-center gap-3 px-4 py-3 border-t border-border">
            <div className="w-2.5 h-2.5 rounded-full bg-accent-red flex-shrink-0 animate-pulse" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-accent-red text-xs font-bold uppercase tracking-wider">Trip in Progress</p>
                {activeRide?.rideType === 'rental' && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(109,40,217,0.12)', color: '#6D28D9' }}>RENTAL</span>
                )}
                {activeRide?.rideType === 'round_trip' && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.12)', color: '#D97706' }}>RETURN</span>
                )}
              </div>
              <p className="text-text-primary font-bold text-sm truncate">
                {currentStop
                  ? `Stop ${currentStop.sequence}: ${currentStop.address ?? 'Next stop'}`
                  : activeRide?.rideType === 'rental' ? 'Flexible route' : (activeRide?.drop ?? '—')}
              </p>
            </div>
            <div className="flex items-center gap-1 text-text-secondary flex-shrink-0">
              <Clock size={14} />
              <span className="font-mono tabular-nums text-sm font-semibold">{elapsed}</span>
            </div>
          </div>
        </div>

        {/* SOS — anchored right below the instruction card, in normal flow. mt-3
            (not mt-2) so it reads as a clearly separate control, not crowded
            against the card's corner (screenshot review, Phase 6). */}
        <div className="flex justify-end mt-3">
          <SOSButton
            rideId={activeRide?.id ?? ''}
            onSOS={handleSOS}
            className="w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform"
            style={GLASS}
          />
        </div>

        {/* GPS-loss warning — safety-critical here (mid-navigation), not just
            informational like the Home screen's version of this banner. */}
        {gpsError && (
          <div className="flex items-center gap-2.5 rounded-2xl px-4 py-3 mt-3" style={GLASS}>
            <LocateOff size={14} className="text-red-500 flex-shrink-0" />
            <span className="text-red-600 text-[12px] font-semibold">
              {gpsError.code === 1
                ? 'Location access denied. Allow it in browser settings'
                : gpsError.code === 2
                ? 'GPS signal unavailable. Check device location settings'
                : 'Location timed out. Ensure GPS is enabled'}
            </span>
          </div>
        )}
      </div>

      {/* Bottom sheet — draggable/tappable to collapse, revealing more map.
          Everything above the collapse anchor (handle, mini status line,
          Complete Trip) stays visible at any sheet height. */}
      <motion.div
        ref={sheetRef}
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl border-t border-border overflow-hidden"
        style={{ zIndex: 10, height: sheetH }}
      >
        <div ref={contentRef} className="px-5 pt-1" style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}>

          {/* Drag handle — drag to any height, or tap to toggle collapsed/peek. */}
          <div
            className="flex justify-center items-center py-2 cursor-grab active:cursor-grabbing select-none"
            style={{ minHeight: 44, touchAction: 'none' }}
            onPointerDown={onSheetPointerDown}
            onPointerMove={onSheetPointerMove}
            onPointerUp={onSheetPointerUp}
            onPointerCancel={onSheetPointerUp}
            role="button"
            aria-label="Drag or tap to expand or collapse trip details"
          >
            <motion.div
              className="rounded-full"
              style={{ width: 36, height: 4, scaleX: handleScaleX, background: handleBg, transformOrigin: 'center' }}
            />
          </div>

          {/* Mini status line — stays visible even fully collapsed. */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-text-secondary text-sm font-semibold truncate">
              {currentStop
                ? `Next: Stop ${currentStop.sequence}`
                : activeRide?.rideType === 'rental' ? 'Flexible route' : (activeRide?.drop ?? 'Destination')}
            </p>
            <div className="text-right flex-shrink-0">
              <p className="text-primary font-black text-base">₹{activeRide?.fare ?? 0}</p>
              {isOneWay && accruedWaitCharge > 0 && (
                <p className="text-[10px] font-semibold text-accent-orange">
                  +₹{accruedWaitCharge.toFixed(0)} wait so far
                </p>
              )}
            </div>
          </div>

          {/* Slide, not tap — accident-proof like the stop-advance controls below;
              hidden while the end-OTP sheet is open so its own retry timer doesn't
              fire a false "couldn't confirm" (that sheet is the real completion, not this). */}
          <motion.div
            animate={nearTarget ? { scale: [1, 1.03, 1] } : { scale: 1 }}
            transition={{ duration: 0.7, repeat: nearTarget ? Infinity : 0, ease: 'easeInOut' }}
            style={{ borderRadius: 9999, boxShadow: nearTarget ? '0 0 0 3px rgba(10, 159, 176,0.35)' : undefined }}
          >
            {!showEndOtp && (
              <SwipeToConfirm
                key={primaryAction.key}
                label={primaryAction.label}
                onConfirm={primaryAction.onConfirm}
                disabled={stopActionPending === currentStop?.sequence}
              />
            )}
          </motion.div>

          {/* Collapse anchor: everything above stays put at any sheet height;
              everything below fades away as the sheet is dragged/tapped down. */}
          <div ref={collapseRef} />

          <motion.div style={{ opacity: belowFoldOpacity }}>

            {/* Context banners */}
            {activeRide?.rideType === 'round_trip' && activeRide.returnAt && (
              <div className="flex items-center gap-2 mt-3 mb-3 px-3 py-2 rounded-xl" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)' }}>
                <RotateCcw size={11} style={{ color: '#D97706' }} className="flex-shrink-0" />
                <p className="text-xs font-semibold" style={{ color: '#D97706' }}>
                  Return by {fmtReturn(activeRide.returnAt)}
                </p>
              </div>
            )}
            {activeRide?.rideType === 'rental' && activeRide.tripHours != null && (
              <div className="flex items-center gap-2 mt-3 mb-3 px-3 py-2 rounded-xl" style={{ background: 'rgba(109,40,217,0.12)', border: '1px solid rgba(109,40,217,0.12)' }}>
                <Clock size={11} style={{ color: '#6D28D9' }} className="flex-shrink-0" />
                <p className="text-xs font-semibold" style={{ color: '#6D28D9' }}>
                  Rental · {activeRide.tripHours}h booked
                </p>
              </div>
            )}

            {/* Waiting meter — one-way only, while the driver waits at a stop */}
            {waitingStop && (
              <div
                className="rounded-2xl mt-3 mb-3 px-4 py-3.5"
                style={{
                  background: waitFreeLeftSec <= 0 ? 'rgba(245,158,11,0.12)' : waitFreeLeftSec <= 120 ? 'rgba(245,158,11,0.10)' : 'rgba(16,185,129,0.10)',
                  border: `1px solid ${waitFreeLeftSec <= 0 || waitFreeLeftSec <= 120 ? 'rgba(245,158,11,0.30)' : 'rgba(16,185,129,0.30)'}`,
                }}
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: waitFreeLeftSec <= 0 || waitFreeLeftSec <= 120 ? '#D97706' : '#059669' }}>
                    Waiting · Stop {waitingStop.sequence}
                  </p>
                  <p className="text-[26px] font-black tabular-nums leading-tight" style={{ color: 'var(--text-primary)' }}>
                    {fmtClock(waitElapsedSec)}
                  </p>
                  <p className="text-[11px] font-medium mt-0.5" style={{ color: waitFreeLeftSec <= 0 || waitFreeLeftSec <= 120 ? '#D97706' : '#059669' }}>
                    {waitFreeLeftSec <= 0
                      ? 'Free wait used — extra time is added to the rider’s fare'
                      : waitFreeLeftSec <= 120
                      ? `Only ${fmtClock(waitFreeLeftSec)} of free wait left`
                      : `${fmtClock(waitFreeLeftSec)} of free wait left`}
                  </p>
                </div>
              </div>
            )}

            {/* Stop itinerary checklist */}
            {stops.length > 0 && (
              <div className="rounded-2xl mt-3 mb-3 overflow-hidden border border-border">
                {currentStop && (
                  <div className="flex items-center gap-2 px-3.5 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: '#0A9FB0', color: '#fff' }}>
                      Stop {currentStop.sequence} of {stops.length}
                    </span>
                    <span className="text-[12px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {currentStop.address ?? `Stop ${currentStop.sequence}`}
                    </span>
                  </div>
                )}
                {stops.map((stop, i) => {
                  const isCurrent = stop.status === 'pending' && currentStop?.sequence === stop.sequence
                  const isPending = stopActionPending === stop.sequence
                  return (
                    <div
                      key={stop.id}
                      className="flex items-center gap-3 px-3.5 py-2.5"
                      style={{
                        borderTop: i > 0 ? '1px solid var(--border)' : undefined,
                        background: isCurrent ? 'rgba(10, 159, 176,0.09)' : undefined,
                      }}
                    >
                      {stop.status === 'reached' ? (
                        <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />
                      ) : stop.status === 'skipped' ? (
                        <X size={16} className="text-text-muted flex-shrink-0" />
                      ) : (
                        <Flag size={16} style={{ color: isCurrent ? '#0A9FB0' : 'var(--text-muted)' }} className="flex-shrink-0" />
                      )}
                      <span
                        className="flex-1 min-w-0 text-sm font-semibold truncate"
                        style={{
                          color: stop.status === 'skipped' ? 'var(--text-muted)' : 'var(--text-primary)',
                          textDecoration: stop.status === 'skipped' ? 'line-through' : undefined,
                        }}
                      >
                        {stop.address ?? `Stop ${stop.sequence}`}
                      </span>
                      {stop.status === 'pending' && (
                        isOneWay && isCurrent && stop.arrived_at != null ? (
                          // Waiting — the primary swipe at the top of the sheet owns the Continue action.
                          // Same clock/colors as the meter banner so it reads as one timer, not two.
                          <span className="text-[11px] font-bold tabular-nums flex-shrink-0" style={{ color: waitFreeLeftSec > 0 ? '#059669' : '#D97706' }}>
                            {fmtClock(waitElapsedSec)}
                          </span>
                        ) : isCurrent ? (
                          // Current stop's confirm is the primary swipe at the top of the sheet; only Skip lives in the row.
                          <button
                            onClick={() => handleStopAction(stop.sequence, 'skipped')}
                            disabled={isPending}
                            className="text-[11px] font-semibold text-text-muted px-2 py-1.5 flex-shrink-0 active:opacity-60 disabled:opacity-40"
                          >
                            Skip
                          </button>
                        ) : (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => handleStopAction(stop.sequence, 'skipped')}
                              disabled={isPending}
                              className="text-[11px] font-semibold text-text-muted px-2 py-1.5 active:opacity-60 disabled:opacity-40"
                            >
                              Skip
                            </button>
                            <button
                              onClick={() => handleStopAction(stop.sequence, 'reached')}
                              disabled={isPending}
                              className="text-[11px] font-bold text-white rounded-full px-3 py-1.5 active:scale-95 transition-transform disabled:opacity-60"
                              style={{ background: '#0A9FB0' }}
                            >
                              {isPending ? '…' : 'Reached'}
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <button
              onClick={() => setShowEndEarlySheet(true)}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-red-400 active:opacity-70 transition-opacity"
            >
              <AlertTriangle size={14} strokeWidth={2} />
              End trip early
            </button>

            <div className="-mx-2 px-3 py-2.5 rounded-2xl bg-surface-2">
              <p className="text-text-muted text-xs mb-0.5">
                {activeRide?.rideType === 'rental' ? 'Route' : 'Drop-off'}
              </p>
              <p className="text-text-primary font-bold text-base">
                {activeRide?.rideType === 'rental' ? 'Flexible · ends at rider request' : (activeRide?.drop ?? '—')}
              </p>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Dim backdrop behind end-OTP sheet */}
      <AnimatePresence>
        {showEndOtp && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0"
              style={{ zIndex: 20, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
              onClick={() => { setShowEndOtp(false); setOtp(''); setOtpError(false) }}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl border-t border-border px-5 pt-5"
              style={{ zIndex: 30, paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-text-primary font-bold text-lg">End Ride OTP</h2>
                  <p className="text-text-muted text-xs">Ask the rider for their end OTP</p>
                </div>
                <button
                  onClick={() => { setShowEndOtp(false); setOtp(''); setOtpError(false) }}
                  className="w-9 h-9 rounded-full bg-surface-3 flex items-center justify-center active:scale-95 transition-transform"
                  aria-label="Close"
                >
                  <X size={16} className="text-text-secondary" />
                </button>
              </div>

              <OtpVerifyPanel
                otp={otp}
                onChange={v => { setOtp(v); setOtpError(false) }}
                error={otpError}
                errorMessage="Wrong OTP, try again"
                submitLabel="Complete Trip"
                verifiedLabel="Trip completed"
                onSubmit={handleCompleteTrip}
                onVerified={() => navigate(
                  activeRide?.paymentChannel === 'cash' ? '/ride/collect-cash' : '/ride/end',
                  { replace: true },
                )}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showEndEarlySheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-end"
          >
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => { if (!endingEarly) setShowEndEarlySheet(false) }}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 350 }}
              className="relative w-full rounded-t-3xl px-5 pt-5 bg-surface"
              style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}
            >
              <div className="w-10 h-1 rounded-full bg-surface-3 mx-auto mb-4" />
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-black text-text-primary">End this trip early?</h3>
                <button
                  onClick={() => setShowEndEarlySheet(false)}
                  disabled={endingEarly}
                  className="w-8 h-8 rounded-full bg-surface-3 flex items-center justify-center active:scale-95 transition-transform"
                >
                  <X size={15} className="text-text-secondary" />
                </button>
              </div>
              <p className="text-text-muted text-xs mb-3">
                The rider will be billed for the distance covered so far. Only end early for a genuine issue.
              </p>
              <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-2.5">Why are you ending early?</p>
              <div className="space-y-2 mb-5">
                {[
                  { code: 'vehicle_breakdown',  label: 'Vehicle breakdown' },
                  { code: 'passenger_emergency', label: 'Passenger emergency' },
                  { code: 'safety_concern',      label: 'Safety concern' },
                  { code: 'other',               label: 'Other reason' },
                ].map(r => (
                  <button
                    key={r.code}
                    onClick={() => setEndEarlyReason(r.code)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left active:scale-[0.98] transition-transform ${
                      endEarlyReason === r.code ? '' : 'bg-surface-2'
                    }`}
                    style={endEarlyReason === r.code
                      ? { background: 'rgba(239,68,68,0.07)', border: '1.5px solid rgba(239,68,68,0.40)' }
                      : { border: '1.5px solid #E2E8F0' }
                    }
                  >
                    <div
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={endEarlyReason === r.code
                        ? { border: '5px solid #EF4444' }
                        : { border: '2px solid #CBD5E1' }
                      }
                    />
                    <span className={`text-sm font-medium ${endEarlyReason === r.code ? 'text-accent-red' : 'text-text-secondary'}`}>
                      {r.label}
                    </span>
                  </button>
                ))}
              </div>
              {endEarlyError && <p className="text-status-error text-xs text-center mb-3">{endEarlyError}</p>}
              <button
                onClick={() => void handleEndEarly()}
                disabled={!endEarlyReason || endingEarly}
                className="w-full py-3.5 rounded-2xl text-sm font-bold text-text-inverse mb-2.5 disabled:opacity-40 active:scale-[0.98] transition-transform"
                style={{ background: '#EF4444' }}
              >
                {endingEarly ? 'Ending trip…' : 'End trip now'}
              </button>
              <button
                onClick={() => setShowEndEarlySheet(false)}
                disabled={endingEarly}
                className="w-full py-3 rounded-2xl text-sm font-semibold text-text-secondary disabled:opacity-50 active:scale-[0.98] transition-transform bg-surface-2 border border-border"
              >
                Continue trip
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <HindiVoiceHint active={!!currentStep} />

      {/* Voice-mute — the one remaining bottom-right utility button, tracks the
          sheet's actual current height. */}
      <VoiceToggleButton style={{ bottom: `calc(env(safe-area-inset-bottom) + ${occlusion + 30}px)`, left: 'auto', right: '16px' }} />

      {/* Re-center chip */}
      <AnimatePresence>
        {mapMode === 'nav' && !following && (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: EASE }}
            onClick={handleRecenter}
            className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full px-4 py-2 active:scale-95 transition-transform"
            style={{ bottom: `calc(env(safe-area-inset-bottom) + ${occlusion + 30}px)`, zIndex: 40, ...GLASS }}
          >
            <Locate size={14} className="text-primary" />
            <span className="text-text-primary text-[13px] font-semibold">Re-center</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
