'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Phone, X, ChevronDown, RotateCcw, CheckCircle, Shield, Clock } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import axios from 'axios'
import { rideApi, type RideDetail } from '@/lib/ride-api'
import RouteTimeline from '@/components/route/RouteTimeline'
import { safetyApi } from '@/lib/safety-api'
import { formatReturnAt } from '@/lib/utils'
import { geoApi } from '@/lib/geo-api'
import { connectSocket, joinRideRoom, leaveRideRoom, getSocket } from '@/lib/socket'
import { useInterpolatedPosition } from '@/lib/useInterpolatedPosition'
import { decodePolyline } from '@/lib/polyline'
import { openRidePaymentCheckout } from '@/lib/razorpay-checkout'
import CancelSheet from './CancelSheet'
import SOSButton from '@/components/ui/SOSButton'

const RideMapScene = dynamic(() => import('@/components/map/RideMapScene'), { ssr: false })

const PICKUP = { lat: 20.2961, lng: 85.8245 }
const DROP   = { lat: 20.2726, lng: 85.8385 }

const EASE = [0.22, 1, 0.36, 1] as const

type RouteMode = 'pickup-dest' | 'driver-pickup' | 'driver-dest' | 'recap'

function routeModeFor(status: string): RouteMode {
  if (status === 'accepted' || status === 'driver_arrived') return 'driver-pickup'
  if (status === 'in_progress') return 'driver-dest'
  if (status === 'completed' || status === 'cancelled') return 'recap'
  return 'pickup-dest'
}

function haversineMetres(a: [number, number], b: [number, number]): number {
  const R = 6_371_000
  const dLat = (b[0] - a[0]) * Math.PI / 180
  const dLng = (b[1] - a[1]) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

type StatusKey = 'scheduled' | 'requested' | 'accepted' | 'driver_arrived' | 'in_progress' | 'completed' | 'cancelled' | 'no_drivers'

const STATUS_CONFIG: Record<StatusKey, { label: string; sub?: string; dot: string; dotPulse: boolean }> = {
  scheduled:      { label: 'Ride scheduled',               sub: 'We’ll find a driver closer to the time', dot: '#4F46E5', dotPulse: false },
  requested:      { label: 'Finding your driver',         sub: 'Usually ready in 15–60 seconds', dot: '#F59E0B', dotPulse: true  },
  accepted:       { label: 'Driver is on the way',                                                 dot: '#2563EB', dotPulse: false },
  driver_arrived: { label: 'Driver has arrived!',          sub: 'Head to your pickup point',       dot: '#16A34A', dotPulse: true  },
  in_progress:    { label: 'On the way to destination',                                             dot: '#2563EB', dotPulse: false },
  completed:      { label: 'You have arrived!',                                                     dot: '#16A34A', dotPulse: false },
  cancelled:      { label: 'Ride cancelled',               sub: 'Returning to home…',              dot: '#DC2626', dotPulse: false },
  no_drivers:     { label: 'No drivers available',         sub: 'Please try again in a moment',    dot: '#DC2626', dotPulse: false },
}

function getInitials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function SearchingDots() {
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: '#F59E0B' }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  )
}

// Compact pickup/drop row — shared by the searching and driver-assigned states
// instead of two near-duplicate 45-line blocks. Colors/spacing per DESIGN.md
// (Surface 2, Border, Ink tokens; no tracked-uppercase field labels — see
// the "No Eyebrow Rule").
function RouteRow({ ride, fare }: { ride: RideDetail | null; fare: string | null }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 rounded-2xl" style={{ background: '#F5F7FF', border: '1px solid #E8EEFF' }}>
      <div className="flex flex-col items-center gap-1 flex-shrink-0">
        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#4F46E5' }} />
        <div className="w-px flex-1" style={{ background: '#E8EEFF', height: 20 }} />
        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#0F172A' }} />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <div>
          <p className="text-[12px] font-medium" style={{ color: '#94A3B8' }}>Pickup</p>
          <p className="text-sm font-medium truncate" style={{ color: '#0F172A' }}>{ride?.origin_address ?? 'Your location'}</p>
        </div>
        <div>
          <p className="text-[12px] font-medium" style={{ color: '#94A3B8' }}>
            {ride?.ride_type === 'round_trip' ? 'Drop & return' : ride?.ride_type === 'rental' ? 'Route' : 'Drop'}
          </p>
          <p className="text-sm font-medium truncate" style={{ color: '#0F172A' }}>
            {ride?.ride_type === 'rental'
              ? (ride.trip_hours ? `${ride.trip_hours}h rental · flexible` : 'Hourly rental · flexible')
              : (ride?.destination_address ?? 'Destination')}
          </p>
          {ride?.ride_type === 'round_trip' && ride.return_at && (
            <p className="text-[12px] font-medium mt-0.5" style={{ color: '#7C3AED' }}>Back by {formatReturnAt(ride.return_at)}</p>
          )}
        </div>
      </div>
      {fare && (
        <div className="flex-shrink-0 text-right">
          <p className="text-[12px] font-medium" style={{ color: '#94A3B8' }}>Est. fare</p>
          <p className="text-base font-bold" style={{ color: '#0F172A' }}>{fare}</p>
        </div>
      )}
    </div>
  )
}

// Compact driver identity row for the sheet's peek state — avatar, name,
// rating/plate, call. Replaces the always-expanded 64-line driver card.
function DriverMiniRow({ ride }: { ride: RideDetail | null }) {
  return (
    <div className="flex items-center gap-2.5 flex-1 min-w-0 px-3 py-2 rounded-2xl" style={{ background: '#F5F7FF', border: '1px solid #E8EEFF' }}>
      {ride?.driver_photo ? (
        <img
          src={ride.driver_photo}
          alt={ride?.driver_name ?? 'Driver'}
          className="w-9 h-9 rounded-xl object-cover flex-shrink-0"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      ) : (
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-[12px] font-bold"
          style={{ background: 'linear-gradient(135deg, #4F46E5, #7C3AED)' }}
        >
          {ride?.driver_name ? getInitials(ride.driver_name) : '?'}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[13px] leading-tight truncate" style={{ color: '#0F172A' }}>{ride?.driver_name ?? 'Your Driver'}</p>
        <div className="flex items-center gap-1 mt-0.5">
          {ride?.driver_rating ? (
            <>
              <span className="text-amber-400 text-[10px]">★</span>
              <span className="text-[11px] font-medium" style={{ color: '#475569' }}>{Number(ride.driver_rating).toFixed(1)}</span>
            </>
          ) : (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: '#D1FAE5', color: '#10B981' }}>New</span>
          )}
          {ride?.vehicle_number_plate && (
            <>
              <span className="text-[10px]" style={{ color: '#E8EEFF' }}>·</span>
              <span className="text-[11px] font-semibold tracking-wide truncate" style={{ color: '#475569' }}>{ride.vehicle_number_plate}</span>
            </>
          )}
        </div>
      </div>
      {ride?.driver_phone && (
        <a
          href={`tel:${ride.driver_phone}`}
          className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95 transition-transform flex-shrink-0"
          style={{ background: '#EEF2FF' }}
          aria-label="Call driver"
        >
          <Phone size={14} style={{ color: '#4F46E5' }} />
        </a>
      )}
    </div>
  )
}

// Single-row OTP display — replaces two 50-line gradient "OTP cards" (one per
// phase). No copy affordance: this code is read aloud to the driver, never
// shared or sent, so there's nothing to copy it into.
function OtpBadge({ otp, phase }: { otp: string | null; phase: 'start' | 'end' }) {
  const accent = phase === 'start' ? '#10B981' : '#7C3AED'
  const bg     = phase === 'start' ? '#D1FAE5' : '#EDE9FE'
  const label  = phase === 'start' ? 'Trip OTP' : 'End OTP'

  if (!otp) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl flex-shrink-0" style={{ background: '#F5F7FF', border: '1px solid #E8EEFF' }}>
        <div className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin flex-shrink-0" style={{ borderColor: accent, borderTopColor: 'transparent' }} />
        <span className="text-[12px] font-medium whitespace-nowrap" style={{ color: '#475569' }}>Generating…</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2.5 pl-2.5 pr-3.5 py-2 rounded-xl flex-shrink-0" style={{ background: bg }}>
      <Shield size={14} style={{ color: accent }} className="flex-shrink-0" />
      <div className="flex flex-col leading-none gap-1">
        <span className="text-[11px] font-medium" style={{ color: accent }}>{label}</span>
        <span className="text-lg font-bold tabular-nums" style={{ color: '#0F172A', letterSpacing: '0.14em' }}>{otp}</span>
      </div>
    </div>
  )
}

export default function RidePage() {
  const params = useParams<{ id: string }>()
  const rideId = params?.id ?? ''
  const router  = useRouter()

  const [ride,           setRide]           = useState<RideDetail | null>(null)
  const [rideStatus,     setRideStatus]     = useState<string>('requested')
  const [driverPos,      setDriverPos]      = useState<[number, number] | undefined>(undefined)
  const [encodedPolyline, setEncodedPolyline] = useState<string | undefined>(undefined)
  const [liveEta, setLiveEta] = useState<{ etaMin: number; distanceKm: number } | null>(null)
  // Timestamp of the last server ETA fetch — drives the 1s client-side countdown
  // between fetches (see displayEta below) so the number visibly ticks instead
  // of sitting frozen for up to 60s (docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 3a).
  const [liveEtaAt, setLiveEtaAt] = useState<number | null>(null)
  const [nowTick, setNowTick] = useState(0)
  const [socketOk,       setSocketOk]       = useState(false)
  const [cancelling,     setCancelling]     = useState(false)
  const [startOtp,       setStartOtp]       = useState<string | null>(null)
  const [endOtp,         setEndOtp]         = useState<string | null>(null)
  const [showCancelSheet, setShowCancelSheet] = useState(false)
  const [sheetExpanded,  setSheetExpanded]  = useState(false)
  const [fareDrift, setFareDrift] = useState<{ previousFare: number; currentFare: number } | null>(null)
  const [reportSending,  setReportSending]  = useState(false)
  const [reportSent,     setReportSent]     = useState(false)
  const pollRef        = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastFetch      = useRef<{ mode: RouteMode; origin: [number, number]; dest: [number, number]; at: number } | null>(null)
  const fetchSeq       = useRef(0)
  const breadcrumbRef  = useRef<[number, number][]>([])
  const [breadcrumb, setBreadcrumb] = useState<[number, number][]>([])
  const [userPos,        setUserPos]        = useState<[number, number] | undefined>(undefined)
  const [nearbyDrivers,  setNearbyDrivers]  = useState<Array<{ driver_id: string; lat: number; lng: number }>>([])
  const rideStatusRef  = useRef(rideStatus)

  // Keep ref in sync so the driver:location handler reads the live status without stale closure
  useEffect(() => { rideStatusRef.current = rideStatus }, [rideStatus])

  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      p => setUserPos([p.coords.latitude, p.coords.longitude]),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  // Ambient "drivers near you" markers while searching, stops once a driver is assigned
  useEffect(() => {
    if (rideStatus !== 'requested' || !ride) { setNearbyDrivers([]); return }
    const fetchNearby = async () => {
      try { setNearbyDrivers(await rideApi.getNearbyDrivers(ride.origin_lat, ride.origin_lng)) } catch { /* ignore */ }
    }
    void fetchNearby()
    const id = setInterval(fetchNearby, 8000)
    return () => clearInterval(id)
  }, [rideStatus, ride?.origin_lat, ride?.origin_lng])

  // Snap target for useInterpolatedPosition — see its doc comment. Recomputed only
  // when the route string itself changes, not on every driver GPS tick.
  const routePoints = useMemo(
    () => (encodedPolyline ? decodePolyline(encodedPolyline) : undefined),
    [encodedPolyline],
  )
  const { pos: smoothPos, heading: smoothHeading, headingKnown: smoothHeadingKnown, matchedSegmentIndex } = useInterpolatedPosition(driverPos, routePoints)

  // Trim the drawn route to what's still ahead of the last on-route snap —
  // see docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 7b. Undefined (falls back to
  // the full route) whenever there's no snap yet.
  const remainingPath = useMemo<[number, number][] | undefined>(() => {
    if (matchedSegmentIndex == null || !routePoints || !smoothPos || routePoints.length === 0) return undefined
    const tail = routePoints.slice(matchedSegmentIndex + 1)
    // Near arrival `tail` runs dry (the snap reaches the route's last segment) —
    // append the route's true final point so the line still has >=2 points instead
    // of vanishing early (same bug/fix as the driver app — see
    // docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 10b).
    const finalPoint = routePoints[routePoints.length - 1]!
    const lastTailPoint = tail[tail.length - 1]
    const alreadyEndsThere = lastTailPoint
      && lastTailPoint[0] === finalPoint[0] && lastTailPoint[1] === finalPoint[1]
    return alreadyEndsThere ? [smoothPos, ...tail] : [smoothPos, ...tail, finalPoint]
  }, [matchedSegmentIndex, routePoints, smoothPos])

  const loadRide = useCallback(async () => {
    try {
      const data = await rideApi.getRide(rideId)
      setRide(data)
      setRideStatus(data.status)
      if (data.startOtp) setStartOtp(data.startOtp)
      if (data.endOtp)   setEndOtp(data.endOtp)
      if (data.driver_current_lat != null && data.driver_current_lng != null) {
        setDriverPos(prev => prev ?? [data.driver_current_lat!, data.driver_current_lng!])
      }
    } catch (err) {
      // Stale ride id (back button / reopened tab pointing at a ride that's
      // since completed, or isn't ours). Bail out instead of getting stuck
      // on the "Finding your driver" skeleton forever. Transient errors
      // (network/5xx) fall through and get retried by the poll/socket.
      if (axios.isAxiosError(err) && (err.response?.status === 404 || err.response?.status === 403)) {
        router.replace('/home')
      }
    }
  }, [rideId, router])

  async function handleReportProblem() {
    setReportSending(true)
    try {
      await safetyApi.triggerSos({
        rideId,
        severity: 'low',
        notes: 'Rider reported this trip appears stuck (no driver updates).',
      })
      setReportSent(true)
    } catch { /* keep button available to retry */ } finally {
      setReportSending(false)
    }
  }

  async function handleSOS() {
    await safetyApi.triggerSos({
      rideId,
      severity: 'high',
      lat: userPos?.[0],
      lng: userPos?.[1],
    })
  }

  useEffect(() => {
    if (!rideId) return
    void loadRide()

    connectSocket()
    const socket = getSocket()
    joinRideRoom(rideId)

    const onConnect = () => {
      setSocketOk(true)
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      joinRideRoom(rideId)
      void loadRide()
    }
    const onDisconnect = () => {
      setSocketOk(false)
      if (!pollRef.current) pollRef.current = setInterval(() => void loadRide(), 10_000)
    }
    const onStatusUpdate = (data: {
      status: string; startOtp?: string; endOtp?: string
      fareDrift?: { previousFare: number; currentFare: number }
      paymentChannel?: string
      razorpayOrderId?: string
      razorpayKey?: string
      amount?: number
    }) => {
      setRideStatus(data.status)
      if (data.startOtp) setStartOtp(data.startOtp)
      if (data.endOtp)   setEndOtp(data.endOtp)
      if (data.fareDrift) {
        setFareDrift(data.fareDrift)
        setRide(prev => prev ? { ...prev, total_estimated: String(data.fareDrift!.currentFare) } : prev)
      }
      if (data.status === 'in_progress') {
        breadcrumbRef.current = []
        setBreadcrumb([])
      }
      if (
        data.status === 'completed' &&
        data.paymentChannel === 'online' &&
        data.razorpayOrderId && data.razorpayKey && typeof data.amount === 'number'
      ) {
        void openRidePaymentCheckout(rideId, {
          orderId: data.razorpayOrderId,
          key: data.razorpayKey,
          amount: data.amount,
        }).catch(() => {
          // Checkout failed to open (ad-blocker, offline, CSP). The payment row
          // stays 'pending'; the backend reconciliation sweep eventually marks it
          // 'failed' and notifies the rider (notifyRidePaymentFailed), who can
          // retry from the trip receipt page (ride/[id]/receipt) — see the
          // "Pay now" banner there for the recovery flow.
        })
      }
    }
    const onDriverAssigned = (data: {
      driverName?: string | null; driverPhone?: string | null
      driverRating?: string | null; driverPhoto?: string | null
      vehicleModel?: string | null; vehicleBrand?: string | null
      vehicleColor?: string | null; vehicleName?: string | null
      vehicleNumberPlate?: string | null
    }) => {
      setRideStatus('accepted')
      setRide(prev => prev ? {
        ...prev,
        driver_name:          data.driverName          ?? prev.driver_name,
        driver_phone:         data.driverPhone         ?? prev.driver_phone,
        driver_rating:        data.driverRating        ?? prev.driver_rating,
        driver_photo:         data.driverPhoto         ?? prev.driver_photo,
        vehicle_model:        data.vehicleModel        ?? prev.vehicle_model,
        vehicle_brand:        data.vehicleBrand        ?? prev.vehicle_brand,
        vehicle_color:        data.vehicleColor        ?? prev.vehicle_color,
        vehicle_name:         data.vehicleName         ?? prev.vehicle_name,
        vehicle_number_plate: data.vehicleNumberPlate  ?? prev.vehicle_number_plate,
      } : prev)
    }
    const onDriverLocation = (data: { lat: number; lng: number; heading: number }) => {
      setDriverPos([data.lat, data.lng])
    }
    // Road-snapped trail segments (see api rides.service.ts updateLocation) —
    // replaces raw per-ping breadcrumb points so the line follows actual roads
    // instead of cutting straight lines through buildings/water.
    const onTrailSegment = (data: { points: Array<{ lat: number; lng: number }> }) => {
      if (rideStatusRef.current !== 'in_progress') return
      const next: [number, number][] = [
        ...breadcrumbRef.current,
        ...data.points.map((p): [number, number] => [p.lat, p.lng]),
      ]
      breadcrumbRef.current = next
      setBreadcrumb(next)
    }
    const onStuckFlagged = (data: { reason?: string }) => {
      setRide(prev => prev ? {
        ...prev,
        review_flagged_at: prev.review_flagged_at ?? new Date().toISOString(),
        review_reason:      data.reason ?? prev.review_reason,
      } : prev)
    }
    const onStopUpdated = (data: { sequence: number; status: 'reached' | 'skipped'; reachedAt: string | null }) => {
      setRide(prev => prev ? {
        ...prev,
        stops: prev.stops.map(s => s.sequence === data.sequence
          ? { ...s, status: data.status, reached_at: data.reachedAt }
          : s),
      } : prev)
    }

    socket.on('connect',            onConnect)
    socket.on('disconnect',         onDisconnect)
    socket.on('ride:status_update', onStatusUpdate)
    socket.on('ride:driver_assigned', onDriverAssigned)
    socket.on('driver:location',    onDriverLocation)
    socket.on('driver:trail_segment', onTrailSegment)
    socket.on('ride:stuck_flagged', onStuckFlagged)
    socket.on('stop:updated',       onStopUpdated)

    // Reconcile ride state when the tab resumes from background.
    // The poll and socket may have stalled while the screen was off.
    const onVisible = () => { if (document.visibilityState === 'visible') void loadRide() }
    document.addEventListener('visibilitychange', onVisible)

    const fallbackTimer = setTimeout(() => {
      if (!socket.connected) pollRef.current = setInterval(() => void loadRide(), 10_000)
    }, 3000)

    return () => {
      leaveRideRoom(rideId)
      socket.off('connect',            onConnect)
      socket.off('disconnect',         onDisconnect)
      socket.off('ride:status_update', onStatusUpdate)
      socket.off('ride:driver_assigned', onDriverAssigned)
      socket.off('driver:location',    onDriverLocation)
      socket.off('driver:trail_segment', onTrailSegment)
      socket.off('ride:stuck_flagged', onStuckFlagged)
      socket.off('stop:updated',       onStopUpdated)
      document.removeEventListener('visibilitychange', onVisible)
      clearTimeout(fallbackTimer)
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [rideId, loadRide])

  useEffect(() => {
    if (rideStatus === 'completed') {
      const t = setTimeout(() => router.replace(`/ride/${rideId}/rate`), 2000)
      return () => clearTimeout(t)
    }
    if (rideStatus === 'cancelled' || rideStatus === 'no_drivers') {
      const t = setTimeout(() => router.replace('/home'), 3000)
      return () => clearTimeout(t)
    }
  }, [rideStatus, rideId, router])

  const pickupPos = useMemo<[number, number]>(
    () => ride ? [ride.origin_lat, ride.origin_lng] : [PICKUP.lat, PICKUP.lng],
    [ride]
  )
  const dropPos = useMemo<[number, number]>(
    () => ride?.dest_lat != null && ride.dest_lng != null ? [ride.dest_lat, ride.dest_lng] : [DROP.lat, DROP.lng],
    [ride]
  )
  const hasDest   = ride?.dest_lat != null && ride?.dest_lng != null
  const routeMode = routeModeFor(rideStatus)
  const mapCenter: [number, number] = smoothPos ?? pickupPos

  useEffect(() => {
    if (!ride) return
    const hd = ride.dest_lat != null && ride.dest_lng != null

    let origin: [number, number]
    let dest: [number, number]

    if (routeMode === 'driver-pickup') {
      if (!driverPos) return
      origin = driverPos
      dest   = userPos ?? pickupPos
    } else if (routeMode === 'driver-dest') {
      if (!driverPos || !hd) return
      origin = driverPos
      dest   = dropPos
    } else {
      if (!hd) return
      origin = pickupPos
      dest   = dropPos
    }

    const prev        = lastFetch.current
    const modeChanged = !prev || prev.mode !== routeMode
    const deviated    = prev && driverPos ? haversineMetres(driverPos, prev.origin) > 200 : false
    const userDeviated = prev && userPos ? haversineMetres(userPos, prev.dest) > 100 : false
    const stale       = prev ? (Date.now() - prev.at) > 60_000 : false

    if (!modeChanged && !deviated && !userDeviated && !stale) return
    if (routeMode === 'recap' && prev?.mode === 'recap') return

    const seq = ++fetchSeq.current
    lastFetch.current = { mode: routeMode, origin, dest, at: Date.now() }
    if (modeChanged) { setEncodedPolyline(undefined); setLiveEta(null); setLiveEtaAt(null) }

    // Live ETA only makes sense once a driver is actually en route (pickup or dest leg) —
    // meaningless during the pre-assignment search phase or the post-trip recap.
    const wantsEta = routeMode === 'driver-pickup' || routeMode === 'driver-dest'

    geoApi.getRoute(origin[0], origin[1], dest[0], dest[1], { trafficAware: wantsEta })
      .then(r => {
        if (fetchSeq.current !== seq) return
        setEncodedPolyline(r.polyline || undefined)
        if (wantsEta) {
          setLiveEta({ etaMin: Math.round(r.trafficDurationMin ?? r.durationMin), distanceKm: r.distanceKm })
          setLiveEtaAt(Date.now())
        } else {
          setLiveEta(null)
          setLiveEtaAt(null)
        }
      })
      .catch(() => { if (fetchSeq.current === seq) { setEncodedPolyline(undefined); setLiveEta(null); setLiveEtaAt(null) } })
  }, [routeMode, driverPos, userPos, pickupPos, dropPos, ride])

  // Tick the displayed ETA down every second between server refreshes instead of
  // leaving it frozen — derives remaining time/distance from the rate implied by
  // the last server fetch, easing toward whatever the next real fetch says.
  useEffect(() => {
    if (!liveEta || liveEtaAt == null) return
    setNowTick(Date.now())
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [liveEta, liveEtaAt])

  const displayEta = useMemo(() => {
    if (!liveEta || liveEtaAt == null || nowTick === 0) return liveEta
    const rateKmPerMin = liveEta.etaMin > 0 ? liveEta.distanceKm / liveEta.etaMin : 0
    const elapsedMin = (nowTick - liveEtaAt) / 60_000
    return {
      etaMin:     Math.max(0, Math.round(liveEta.etaMin - elapsedMin)),
      distanceKm: Math.max(0, liveEta.distanceKm - rateKmPerMin * elapsedMin),
    }
  }, [liveEta, liveEtaAt, nowTick])

  const status    = (rideStatus as StatusKey) in STATUS_CONFIG ? (rideStatus as StatusKey) : 'requested'
  const cfg       = {
    ...STATUS_CONFIG[status],
    ...(status === 'in_progress' && ride?.ride_type === 'rental'
      ? { label: 'Rental in progress', sub: 'Flexible route active' }
      : {}),
  }
  const hasDriver = rideStatus !== 'requested' && rideStatus !== 'scheduled'

  const fare = ride?.total_estimated != null ? `₹${Math.round(parseFloat(ride.total_estimated))}` : null

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">

      {/* ── Map ── */}
      <div className="relative" style={{ flex: '1 1 0', minHeight: 0 }}>
        <RideMapScene
          center={mapCenter}
          pickupPos={pickupPos}
          dropPos={dropPos}
          encodedPolyline={encodedPolyline}
          driverPos={smoothPos}
          driverHeading={smoothHeading}
          driverHeadingKnown={smoothHeadingKnown}
          routeMode={routeMode}
          showDrop={hasDest}
          breadcrumb={breadcrumb}
          userPos={userPos}
          nearbyDrivers={nearbyDrivers}
          remainingPath={remainingPath}
        />

        {/* Dev socket indicator */}
        {process.env.NODE_ENV === 'development' && (
          <div className={`absolute top-4 right-4 z-10 w-2 h-2 rounded-full shadow ${socketOk ? 'bg-green-500' : 'bg-amber-400'}`} />
        )}

        {/* SOS: available throughout the trip, not just after something's gone wrong */}
        {status !== 'completed' && status !== 'cancelled' && status !== 'no_drivers' && (
          <div className="absolute top-4 right-4 z-20" style={{ marginTop: 'env(safe-area-inset-top)' }}>
            <SOSButton onSOS={handleSOS} />
          </div>
        )}
      </div>

      {/* ── Bottom sheet ── */}
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300, delay: 0.08 }}
        className="bg-background rounded-t-[28px] shadow-[0_-4px_32px_rgba(0,0,0,0.10)]"
        style={{ flexShrink: 0 }}
      >
        {/* Handle — tap to expand/collapse trip details */}
        <button
          type="button"
          onClick={() => setSheetExpanded(v => !v)}
          className="w-full flex justify-center pt-3 pb-1"
          aria-label={sheetExpanded ? 'Collapse trip details' : 'Expand trip details'}
          aria-expanded={sheetExpanded}
        >
          <div className="w-9 h-1 rounded-full bg-gray-200" />
        </button>

        {/* ── Status badge row ── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={status}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="flex items-center gap-3 mx-4 mt-3 mb-4 px-4 py-3 rounded-2xl"
            style={{
              background: status === 'requested'      ? 'rgba(245,158,11,0.08)'
                        : status === 'driver_arrived' ? 'rgba(22,163,74,0.08)'
                        : status === 'completed'      ? 'rgba(22,163,74,0.08)'
                        : (status === 'cancelled' || status === 'no_drivers') ? 'rgba(220,38,38,0.08)'
                        : 'rgba(37,99,235,0.07)',
              border: `1px solid ${
                status === 'requested'      ? 'rgba(245,158,11,0.22)'
                : status === 'driver_arrived' ? 'rgba(22,163,74,0.22)'
                : status === 'completed'    ? 'rgba(22,163,74,0.22)'
                : (status === 'cancelled' || status === 'no_drivers') ? 'rgba(220,38,38,0.22)'
                : 'rgba(37,99,235,0.18)'
              }`,
            }}
          >
            {/* Dot */}
            <div className="relative flex-shrink-0 w-3 h-3">
              {cfg.dotPulse && (
                <div
                  className="absolute inset-0 rounded-full animate-ping"
                  style={{ background: cfg.dot, opacity: 0.35 }}
                />
              )}
              <div className="relative w-3 h-3 rounded-full" style={{ background: cfg.dot }} />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 leading-tight">{cfg.label}</p>
              {cfg.sub && <p className="text-xs text-gray-500 mt-0.5">{cfg.sub}</p>}
            </div>

            {status === 'requested' && <SearchingDots />}
            {displayEta && (
              <div className="flex-shrink-0 text-right">
                <p className="text-sm font-bold text-gray-900 leading-tight tabular-nums">{displayEta.etaMin} min</p>
                <p className="text-[11px] text-gray-500 tabular-nums">{displayEta.distanceKm.toFixed(1)} km</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* ── Content ── */}
        <AnimatePresence mode="wait">

          {/* Searching */}
          {!hasDriver && (
            <motion.div
              key="searching"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="px-4 pb-6"
            >
              <div className="mb-4">
                <RouteRow ride={ride} fare={fare} />
              </div>

              {fareDrift && (
                <div
                  className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl mb-3"
                  style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}
                >
                  <div>
                    <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide">Fare updated</p>
                    <p className="text-[13px] font-bold text-amber-800">
                      ₹{Math.round(fareDrift.previousFare)} → ₹{Math.round(fareDrift.currentFare)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFareDrift(null)}
                    className="text-[11px] font-semibold text-amber-700"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {rideStatus === 'scheduled' && ride?.scheduled_for && (
                <div
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl mb-3"
                  style={{ background: 'rgba(79,70,229,0.08)', border: '1px solid rgba(79,70,229,0.20)' }}
                >
                  <Clock size={13} className="text-indigo-500 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wide">Pickup time</p>
                    <p className="text-[13px] font-bold text-indigo-800">{formatReturnAt(ride.scheduled_for)}</p>
                  </div>
                </div>
              )}

              {ride?.ride_type === 'round_trip' && ride.return_at && (
                <div
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl mb-3"
                  style={{ background: '#EEF2FF', border: '1px solid #C7D2FE' }}
                >
                  <RotateCcw size={13} className="text-violet-500 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold text-violet-400 uppercase tracking-wide">Return by</p>
                    <p className="text-[13px] font-bold text-violet-800">{formatReturnAt(ride.return_at)}</p>
                  </div>
                </div>
              )}

              {ride?.ride_type === 'rental' && (
                <div
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl mb-3"
                  style={{ background: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.20)' }}
                >
                  <Clock size={13} className="text-sky-500 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold text-sky-400 uppercase tracking-wide">Rental package</p>
                    <p className="text-[13px] font-bold text-sky-800">
                      {ride.trip_hours ? `${ride.trip_hours}-hour package · flexible route` : 'Hourly rental · flexible route'}
                    </p>
                  </div>
                </div>
              )}

              <button
                onClick={() => setShowCancelSheet(true)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-red-600 active:opacity-70 transition-opacity"
                style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.16)' }}
              >
                <X size={15} strokeWidth={2.5} />
                Cancel ride
              </button>
            </motion.div>
          )}

          {/* Driver assigned — peek row always visible, detail expands on demand */}
          {hasDriver && (
            <motion.div
              key="driver"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="px-4"
            >
              {/* Peek row: driver identity + call, plus whatever the rider needs to act on right now */}
              <div className="flex items-center gap-2 mb-2">
                <DriverMiniRow ride={ride} />
                {rideStatus === 'accepted' && fare && (
                  <div className="flex-shrink-0 text-right px-1">
                    <p className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>Fare</p>
                    <p className="text-sm font-bold" style={{ color: '#0F172A' }}>{fare}</p>
                  </div>
                )}
                {rideStatus === 'driver_arrived' && <OtpBadge otp={startOtp} phase="start" />}
                {rideStatus === 'in_progress' && <OtpBadge otp={endOtp} phase="end" />}
              </div>

              {/* Rare safety note — surfaced even collapsed, unlike routine trip detail */}
              {rideStatus === 'in_progress' && ride?.review_flagged_at && (
                <div className="flex items-start gap-2 px-4 py-2.5 rounded-2xl mb-2"
                  style={{ background: 'rgba(217,119,6,0.06)', border: '1px solid rgba(217,119,6,0.18)' }}>
                  <Shield size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <span className="text-sm font-medium text-amber-700">
                    We noticed this trip hasn&apos;t updated in a while. Our support team has been notified and is reviewing it.
                  </span>
                </div>
              )}

              {rideStatus === 'completed' && (
                <div className="flex items-center justify-between px-4 py-2.5 rounded-2xl mb-2"
                  style={{ background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.18)' }}>
                  <div className="flex items-center gap-2">
                    <CheckCircle size={14} className="text-green-600" />
                    <span className="text-sm font-semibold text-green-700">Trip complete</span>
                  </div>
                  {fare && <span className="text-base font-black text-gray-900">{fare}</span>}
                </div>
              )}

              <button
                type="button"
                onClick={() => setSheetExpanded(v => !v)}
                className="w-full flex items-center justify-center gap-1 py-2 text-xs font-semibold text-gray-400"
              >
                {sheetExpanded ? 'Hide trip details' : 'Trip details'}
                <ChevronDown size={13} style={{ transform: sheetExpanded ? 'rotate(180deg)' : undefined, transition: 'transform 200ms' }} />
              </button>

              <AnimatePresence initial={false}>
                {sheetExpanded && (
                  <motion.div
                    key="expanded"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: EASE }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="pb-4 space-y-3">
                      <RouteRow ride={ride} fare={rideStatus === 'accepted' ? null : fare} />

                      {/* Stop itinerary — mirrors driver state via the stop:updated socket event */}
                      {ride && ride.stops.length > 0 && (
                        <RouteTimeline
                          nodes={ride.stops.map((stop, i) => ({
                            kind: 'stop' as const,
                            key: stop.id,
                            address: stop.address ?? `Stop ${i + 1}`,
                            state: stop.status,
                          }))}
                        />
                      )}

                      {(rideStatus === 'accepted' || rideStatus === 'driver_arrived') && (
                        <button
                          onClick={() => setShowCancelSheet(true)}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-medium text-red-500 active:opacity-70 transition-opacity"
                          style={{ background: 'rgba(220,38,38,0.05)', border: '1px solid rgba(220,38,38,0.12)' }}
                        >
                          <X size={14} strokeWidth={2} />
                          Cancel ride
                        </button>
                      )}

                      {rideStatus === 'in_progress' && (
                        <button
                          onClick={() => void handleReportProblem()}
                          disabled={reportSending || reportSent}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-medium text-amber-600 active:opacity-70 transition-opacity disabled:opacity-50"
                          style={{ background: 'rgba(217,119,6,0.05)', border: '1px solid rgba(217,119,6,0.12)' }}
                        >
                          <Shield size={14} strokeWidth={2} />
                          {reportSent ? 'Support notified' : reportSending ? 'Reporting…' : "Something's wrong"}
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

        </AnimatePresence>

      </motion.div>

      {showCancelSheet && (
        <CancelSheet
          feeWarning={rideStatus === 'accepted' || rideStatus === 'driver_arrived'}
          onClose={() => setShowCancelSheet(false)}
          onConfirm={async (reasonCode, reason) => {
            setCancelling(true)
            try {
              await rideApi.cancelRide(rideId, reasonCode, reason)
              setRideStatus('cancelled')
            } catch {
              router.push('/home')
            } finally {
              setCancelling(false)
              setShowCancelSheet(false)
            }
          }}
        />
      )}
    </div>
  )
}
