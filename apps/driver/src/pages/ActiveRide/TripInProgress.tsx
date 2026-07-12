import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, X, RotateCcw, Flag, CheckCircle2, Navigation, Locate, Check } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import SOSButton from '@/components/ui/SOSButton'
import OtpVerifyPanel from '@/components/ui/OtpVerifyPanel'
import VoiceToggleButton from '@/components/ui/VoiceToggleButton'
import HindiVoiceHint from '@/components/ui/HindiVoiceHint'
import ManeuverBanner from '@/components/map/ManeuverBanner'
import { useRideStore } from '@/store/useRideStore'
import { useSessionStore } from '@/store/useSessionStore'
import { useNavPrefsStore } from '@/store/useNavPrefsStore'
import { driverRideApi } from '@/lib/ride-api'
import { driverSafetyApi } from '@/lib/safety-api'
import { EASE, GLASS, fmtReturn } from '@/lib/constants'
import { useDriverLocation } from '@/lib/useDriverLocation'
import { useTurnByTurn } from '@/lib/useTurnByTurn'
import { useVoiceGuidance } from '@/lib/useVoiceGuidance'
import { useWakeLock } from '@/lib/useWakeLock'
import { haversineMetres } from '@/lib/geo'

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
  const { activeRide, updateRideStatus, updateStop } = useRideStore()
  const elapsed = useElapsed(activeRide?.rideStartedAt)
  const { sessionId } = useSessionStore()

  const [showEndOtp, setShowEndOtp] = useState(false)
  const [otp, setOtp]               = useState('')
  const [otpError, setOtpError]     = useState(false)
  const [stopActionPending, setStopActionPending] = useState<number | null>(null)

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

  const dropPos: [number, number] = currentStop
    ? [currentStop.lat, currentStop.lng]
    : [activeRide?.dropLat ?? DEFAULT_LAT, activeRide?.dropLng ?? DEFAULT_LNG]

  async function handleStopAction(sequence: number, status: 'reached' | 'skipped') {
    if (!activeRide || stopActionPending !== null) return
    setStopActionPending(sequence)
    try {
      const res = await driverRideApi.markStopStatus(activeRide.id, sequence, status)
      updateStop(sequence, status, res.stop.reached_at)
    } catch { /* stays pending, driver can retry */ } finally {
      setStopActionPending(null)
    }
  }

  const { position, heading: selfHeading } = useDriverLocation({
    highAccuracy: true,
    syncIntervalMs: 3_000,
    onSync: sessionId
      ? (lat, lng, heading) => {
          driverRideApi.updateLocation({ sessionId: sessionId!, lat, lng, heading, recordedAt: new Date().toISOString() }).catch(() => {})
        }
      : undefined,
  })
  // Fall back to drop only for map centering, never for the car marker or route fetch.
  // Without this guard, the car appears AT the drop pin before GPS resolves, making
  // it look like the driver has already reached the destination.
  const mapCenter: [number, number] = position ?? dropPos

  useWakeLock()

  // Nav target is the current pending stop when one exists, else the final drop —
  // the hook refetches automatically whenever this destination identity changes,
  // e.g. when the driver marks a stop reached/skipped.
  const hasNavTarget = currentStop != null || (activeRide?.dropLat != null && activeRide?.dropLng != null)
  const voiceEnabled = useNavPrefsStore(s => s.voiceEnabled)
  const navLanguage  = useNavPrefsStore(s => s.language)

  const { encodedPolyline, trafficIntervals, trafficPolyline, source, currentStep, distanceToManeuver, isReconnecting } =
    useTurnByTurn(position, hasNavTarget ? dropPos : null, navLanguage)
  useVoiceGuidance(currentStep, distanceToManeuver, voiceEnabled, navLanguage)

  // "Here's the journey" beat on mount (trip just started), "here's the next
  // leg" mini-beat whenever the nav target changes (a stop is reached/skipped
  // and useTurnByTurn's destination — and therefore this key — changes).
  const destKey = hasNavTarget ? `${dropPos[0].toFixed(5)},${dropPos[1].toFixed(5)}` : null
  const prevDestKey = useRef<string | null>(null)
  useEffect(() => {
    if (destKey === null || prevDestKey.current === destKey) return
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
      await driverRideApi.verifyEndOtp(activeRide.id, otp, actualDistanceKm, actualDurationMin || undefined, position?.[0], position?.[1])
      updateRideStatus('completed')
    } catch {
      setOtpError(true)
      setOtp('')
      throw new Error('otp-verify-failed')
    }
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
              heading={selfHeading}
              topPadding={100}
              bottomPadding={220}
              pitch={nearTarget ? 0 : 42}
              distanceToManeuver={nearTarget ? 250 : distanceToManeuver}
              onFollowChange={setFollowing}
              resumeKey={resumeKey}
              suspended={mapMode === 'overview'}
            />
            {hasNavTarget && (
              <>
                <RoutePolyline encoded={encodedPolyline} />
                <TrafficColoredRoute encoded={trafficPolyline} intervals={trafficIntervals} />
              </>
            )}
            {position && <SelfCarMarker position={position} />}
            {hasNavTarget && <LocationPin position={dropPos} variant="drop" />}
            {hasNavTarget && (
              <button
                aria-label="Open in Google Maps"
                style={{ position: 'absolute', left: 16, bottom: 'calc(env(safe-area-inset-bottom) + 284px)', zIndex: 5 }}
                className="w-12 h-12 rounded-2xl bg-surface border border-border shadow-lg flex items-center justify-center active:scale-95 transition-transform"
                onClick={() => window.open(`https://maps.google.com?q=${dropPos[0]},${dropPos[1]}`)}
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

        {/* SOS — anchored right below the instruction card, in normal flow. */}
        <div className="flex justify-end mt-2">
          <SOSButton
            rideId={activeRide?.id ?? ''}
            onSOS={handleSOS}
            className="w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform"
            style={GLASS}
          />
        </div>
      </div>

      {/* Bottom sheet */}
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl border-t border-border px-5 pt-4"
        style={{ zIndex: 10, paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}
      >
        <div className="w-10 h-1 rounded-full bg-surface-3 mx-auto mb-4" />

        {/* Context banners */}
        {activeRide?.rideType === 'round_trip' && activeRide.returnAt && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)' }}>
            <RotateCcw size={11} style={{ color: '#D97706' }} className="flex-shrink-0" />
            <p className="text-xs font-semibold" style={{ color: '#D97706' }}>
              Return by {fmtReturn(activeRide.returnAt)}
            </p>
          </div>
        )}
        {activeRide?.rideType === 'rental' && activeRide.tripHours != null && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl" style={{ background: 'rgba(109,40,217,0.12)', border: '1px solid rgba(109,40,217,0.12)' }}>
            <Clock size={11} style={{ color: '#6D28D9' }} className="flex-shrink-0" />
            <p className="text-xs font-semibold" style={{ color: '#6D28D9' }}>
              Rental · {activeRide.tripHours}h booked
            </p>
          </div>
        )}

        {/* Stop itinerary checklist */}
        {stops.length > 0 && (
          <div className="rounded-2xl mb-3 overflow-hidden border border-border">
            {stops.map((stop, i) => {
              const isCurrent = stop.status === 'pending' && currentStop?.sequence === stop.sequence
              const isPending = stopActionPending === stop.sequence
              return (
                <div
                  key={stop.id}
                  className="flex items-center gap-3 px-3.5 py-2.5"
                  style={{
                    borderTop: i > 0 ? '1px solid var(--border)' : undefined,
                    borderLeft: isCurrent ? '3px solid #4F46E5' : '3px solid transparent',
                    background: isCurrent ? 'rgba(79,70,229,0.05)' : undefined,
                  }}
                >
                  {stop.status === 'reached' ? (
                    <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />
                  ) : stop.status === 'skipped' ? (
                    <X size={16} className="text-text-muted flex-shrink-0" />
                  ) : (
                    <Flag size={16} style={{ color: isCurrent ? '#4F46E5' : 'var(--text-muted)' }} className="flex-shrink-0" />
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
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => handleStopAction(stop.sequence, 'skipped')}
                        disabled={isPending}
                        className="text-[11px] font-semibold text-text-muted px-2 py-1.5 active:opacity-60 disabled:opacity-40"
                      >
                        Skip
                      </button>
                      <motion.button
                        onClick={() => handleStopAction(stop.sequence, 'reached')}
                        disabled={isPending}
                        animate={isCurrent && nearTarget && !isPending ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                        transition={{ duration: 0.7, repeat: isCurrent && nearTarget && !isPending ? Infinity : 0, ease: 'easeInOut' }}
                        className="text-[11px] font-bold text-white rounded-full px-3 py-1.5 active:scale-95 transition-transform disabled:opacity-60"
                        style={{
                          background: '#4F46E5',
                          boxShadow: isCurrent && nearTarget ? '0 0 0 3px rgba(79,70,229,0.30)' : undefined,
                        }}
                      >
                        {isPending ? '…' : 'Reached'}
                      </motion.button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="-mx-2 px-3 py-2.5 rounded-2xl bg-surface-2 mb-4">
          <div className="flex justify-between mb-0.5">
            <p className="text-text-muted text-xs">
              {activeRide?.rideType === 'rental' ? 'Route' : 'Drop-off'}
            </p>
            <p className="text-text-muted text-xs">Fare</p>
          </div>
          <div className="flex justify-between items-start">
            <p className="text-text-primary font-bold text-base flex-1 pr-4">
              {activeRide?.rideType === 'rental' ? 'Flexible · ends at rider request' : (activeRide?.drop ?? '—')}
            </p>
            <p className="text-primary font-black text-2xl flex-shrink-0">₹{activeRide?.fare ?? 0}</p>
          </div>
        </div>

        <motion.button
          onClick={() => setShowEndOtp(true)}
          animate={!currentStop && nearTarget ? { scale: [1, 1.03, 1] } : { scale: 1 }}
          transition={{ duration: 0.7, repeat: !currentStop && nearTarget ? Infinity : 0, ease: 'easeInOut' }}
          className="btn-go w-full active:scale-95 transition-transform"
          style={{ minHeight: 52, boxShadow: !currentStop && nearTarget ? '0 0 0 3px rgba(79,70,229,0.35)' : undefined }}
        >
          Complete Trip
        </motion.button>
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
                onVerified={() => navigate('/ride/end', { replace: true })}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <HindiVoiceHint active={!!currentStep} />

      {/* Voice-mute — the one remaining bottom-right utility button, above the sheet. */}
      <VoiceToggleButton style={{ bottom: 'calc(env(safe-area-inset-bottom) + 344px)', left: 'auto', right: '16px' }} />

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
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 344px)', zIndex: 40, ...GLASS }}
          >
            <Locate size={14} className="text-primary" />
            <span className="text-text-primary text-[13px] font-semibold">Re-center</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
