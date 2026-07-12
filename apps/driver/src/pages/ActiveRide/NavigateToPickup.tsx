import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Navigation, Phone, RotateCcw, Clock, X, Star, Check, Locate } from 'lucide-react'
import SOSButton from '@/components/ui/SOSButton'
import OcarSpinner from '@/components/ui/OcarSpinner'
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
// Route-overview beat before diving into first-person navigation — see
// docs/DRIVER_TRIP_UX_REDESIGN_PLAN.md §3.
const OVERVIEW_BEAT_MS = 1200
// Manual "I'm here" tap still required (GPS drift near buildings) — this only
// relaxes the camera and elevates the CTA, matching Uber/Lyft's own choice
// to keep arrival a driver-confirmed action.
const ARRIVAL_RADIUS_METRES = 75

export default function NavigateToPickup() {
  const navigate = useNavigate()
  const { activeRide, restoreChecked, updateRideStatus, clearRide } = useRideStore()
  const { sessionId } = useSessionStore()
  const [arriving, setArriving]   = useState(false)
  const [arrived, setArrived]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const reduceMotion = useReducedMotion()
  const [showCancelSheet,  setShowCancelSheet]  = useState(false)
  const [cancelReason,     setCancelReason]     = useState<string | null>(null)
  const [cancellingRide,   setCancellingRide]   = useState(false)

  // Map mode system (see docs/DRIVER_TRIP_UX_REDESIGN_PLAN.md §1/§3): starts in
  // OVERVIEW for the "here's your job" beat, dives into NAVIGATION shortly after.
  const [mapMode, setMapMode]   = useState<'overview' | 'nav'>('overview')
  const [following, setFollowing] = useState(true)
  const [resumeKey, setResumeKey] = useState(0)
  const [nearPickup, setNearPickup] = useState(false)
  const announcedArrival = useRef(false)

  useEffect(() => {
    const t = setTimeout(() => setMapMode('nav'), OVERVIEW_BEAT_MS)
    return () => clearTimeout(t)
  }, [])

  function handleRecenter() { setResumeKey(k => k + 1) }
  // Resync on resume is handled by RecenterMap's `suspended` prop itself —
  // no need to also bump resumeKey here.

  // Only evict once session-restore has definitively confirmed there's no
  // active ride — activeRide is briefly null on a hard refresh before the
  // persisted store rehydrates / the restore fetch resolves, and redirecting
  // on that transient null is what used to strand drivers on Home mid-trip.
  useEffect(() => {
    if (!activeRide && restoreChecked) navigate('/', { replace: true })
  }, [activeRide, restoreChecked, navigate])

  const pickupPos: [number, number] = [
    activeRide?.pickupLat ?? DEFAULT_LAT,
    activeRide?.pickupLng ?? DEFAULT_LNG,
  ]

  useWakeLock()

  const { position, heading: selfHeading } = useDriverLocation({
    highAccuracy: true,
    syncIntervalMs: 3_000,
    onSync: sessionId
      ? (lat, lng, heading) => {
          driverRideApi.updateLocation({ sessionId: sessionId!, lat, lng, heading, recordedAt: new Date().toISOString() }).catch(() => {})
        }
      : undefined,
  })
  // Fall back to pickup only for map centering, never for the car marker or route fetch.
  // Without this guard, the car appears AT the pickup pin before GPS resolves, making
  // it look like the driver has already arrived.
  const mapCenter: [number, number] = position ?? pickupPos

  const voiceEnabled = useNavPrefsStore(s => s.voiceEnabled)
  const navLanguage  = useNavPrefsStore(s => s.language)

  const { encodedPolyline, trafficIntervals, trafficPolyline, source, currentStep, distanceToManeuver, isReconnecting } =
    useTurnByTurn(position, pickupPos, navLanguage)
  useVoiceGuidance(currentStep, distanceToManeuver, voiceEnabled, navLanguage)

  // Arrival micro-state: proximity relaxes the camera and elevates the CTA,
  // but never auto-completes the arrival — see ARRIVAL_RADIUS_METRES above.
  useEffect(() => {
    if (!position) return
    setNearPickup(haversineMetres(position, pickupPos) <= ARRIVAL_RADIUS_METRES)
  }, [position, pickupPos])

  useEffect(() => {
    if (!nearPickup || announcedArrival.current || !voiceEnabled) return
    announcedArrival.current = true
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const utterance = new SpeechSynthesisUtterance('You have arrived at the pickup point.')
    utterance.lang = navLanguage === 'hi' ? 'hi-IN' : 'en-IN'
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }, [nearPickup, voiceEnabled, navLanguage])

  const handleSOS = async () => {
    await driverSafetyApi.triggerSos({
      rideId:   activeRide?.id ?? '',
      lat:      position?.[0],
      lng:      position?.[1],
      severity: 'high',
    })
  }

  const handleArrived = async () => {
    if (!activeRide) return
    setArriving(true)
    setError(null)
    try {
      await driverRideApi.markArrived(activeRide.id)
      updateRideStatus('driver_arrived')
      setArrived(true)
      setTimeout(() => navigate('/ride/otp', { replace: true }), reduceMotion ? 0 : 500)
    } catch {
      setError('Failed to mark arrival. Please try again.')
      setArriving(false)
    }
  }

  const handleCancelRide = async () => {
    if (!activeRide || !cancelReason || cancellingRide) return
    setCancellingRide(true)
    try {
      await driverRideApi.cancelRideAsDriver(activeRide.id, cancelReason)
      clearRide()
      navigate('/')
    } catch {
      setCancellingRide(false)
    }
  }

  const avatarLetter = (activeRide?.userName ?? 'R')[0]!.toUpperCase()

  return (
    <div className="relative w-full h-[100dvh] bg-bg overflow-hidden">

      {/* Map */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <Suspense fallback={<div className="w-full h-full bg-surface animate-pulse" />}>
          <DriverMapView initialCenter={mapCenter} zoom={15}>
            <TrafficLayer />
            {mapMode === 'overview' && (
              <FitBoundsToPoints
                points={[position, pickupPos]}
                padding={{ top: 140, bottom: 260, left: 40, right: 40 }}
              />
            )}
            {/* Always mounted (never swapped out for FitBoundsToPoints) so its
                eased pitch/heading/zoom animation state survives mode
                switches — see suspended's doc comment in RecenterMap.tsx. */}
            <RecenterMap
              center={mapCenter}
              heading={selfHeading}
              topPadding={100}
              bottomPadding={220}
              pitch={nearPickup ? 0 : 42}
              // Fixes zoom around ~17 during arrival relaxation (falls in
              // zoomForDistance's 100-300m bucket) instead of continuing to
              // chase the last real maneuver distance.
              distanceToManeuver={nearPickup ? 250 : distanceToManeuver}
              onFollowChange={setFollowing}
              resumeKey={resumeKey}
              suspended={mapMode === 'overview'}
            />
            <RoutePolyline encoded={encodedPolyline} />
            <TrafficColoredRoute encoded={trafficPolyline} intervals={trafficIntervals} />
            {position && <SelfCarMarker position={position} />}
            <LocationPin position={pickupPos} variant="pickup" />
          </DriverMapView>
        </Suspense>
      </div>

      {/* Top instruction card — floats with margin on all sides, fully rounded,
          Google Maps style. Nothing else shares this zone (SOS floats bottom-right
          instead) so it's the only thing up here. */}
      <div
        className="absolute top-0 left-0 right-0 px-4"
        style={{ zIndex: 10, paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}
      >
        <div className="rounded-3xl overflow-hidden" style={GLASS}>
          <AnimatePresence mode="wait">
            {nearPickup ? (
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
                  Pick up {activeRide?.userName ?? 'the rider'}
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
            <div className="w-3 h-3 rounded-full bg-primary flex-shrink-0 animate-pulse" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-text-muted text-xs">Heading to pickup</p>
                {activeRide?.rideType === 'rental' && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(109,40,217,0.12)', color: '#6D28D9' }}>RENTAL</span>
                )}
                {activeRide?.rideType === 'round_trip' && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.12)', color: '#D97706' }}>RETURN</span>
                )}
              </div>
              <p className="text-text-primary font-bold text-base truncate">{activeRide?.pickup ?? '—'}</p>
            </div>
          </div>
        </div>

        {/* SOS — anchored right below the instruction card, in normal flow so
            it always tracks the card's height correctly (never overlaps it,
            whichever row is showing above). Best-reachable top-of-screen spot
            without competing with the nav info itself. */}
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

        {/* Rider row */}
        <div className="flex items-center justify-between mb-4 -mx-2 px-3 py-2.5 rounded-2xl bg-surface-2">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0 shadow-sm">
              <span className="text-primary font-bold text-base">{avatarLetter}</span>
            </div>
            <div>
              <p className="text-text-muted text-xs">Rider</p>
              <div className="flex items-center gap-1.5">
                <p className="text-text-primary font-bold">{activeRide?.userName ?? 'Rider'}</p>
                {activeRide?.userRating != null && activeRide.userRating > 0 && (
                  <span className="flex items-center gap-0.5">
                    <Star size={11} className="text-accent-amber fill-accent-amber" aria-hidden="true" />
                    <span className="text-text-secondary text-xs font-semibold">{activeRide.userRating.toFixed(1)}</span>
                  </span>
                )}
              </div>
              {activeRide?.userPhone && (
                <p className="text-text-muted text-xs">{activeRide.userPhone}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {activeRide?.userPhone && (
              <a
                href={`tel:${activeRide.userPhone}`}
                className="w-11 h-11 rounded-full bg-surface-3 border border-border flex items-center justify-center active:scale-95 transition-transform"
              >
                <Phone size={18} className="text-text-secondary" />
              </a>
            )}
            <button
              className="w-11 h-11 rounded-full bg-primary flex items-center justify-center shadow-button active:scale-95 transition-transform"
              onClick={() => window.open(`https://maps.google.com?q=${pickupPos[0]},${pickupPos[1]}`)}
            >
              <Navigation size={18} className="text-text-inverse" />
            </button>
          </div>
        </div>

        {error && <p className="text-accent-red text-sm mb-3 text-center">{error}</p>}

        <motion.button
          onClick={() => void handleArrived()}
          disabled={arriving}
          animate={nearPickup && !arriving && !arrived ? { scale: [1, 1.03, 1] } : { scale: 1 }}
          transition={{ duration: 0.7, repeat: nearPickup && !arriving && !arrived ? Infinity : 0, ease: 'easeInOut' }}
          className="btn-go w-full flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:active:scale-100"
          style={{ minHeight: 56, boxShadow: nearPickup ? '0 0 0 3px rgba(79,70,229,0.35)' : undefined }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {arrived ? (
              <motion.span
                key="arrived"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85, filter: 'blur(3px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                transition={{ duration: reduceMotion ? 0.01 : 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-center gap-2"
              >
                <Check size={18} strokeWidth={2.5} aria-hidden="true" /> Arrived
              </motion.span>
            ) : arriving ? (
              <motion.span
                key="marking"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85, filter: 'blur(3px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                transition={{ duration: reduceMotion ? 0.01 : 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-center gap-2"
              >
                <OcarSpinner size={16} variant="white" /> Marking arrival…
              </motion.span>
            ) : (
              <motion.span
                key="idle"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85, filter: 'blur(3px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                transition={{ duration: reduceMotion ? 0.01 : 0.25, ease: [0.22, 1, 0.36, 1] }}
              >
                Arrived at Pickup
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>

        <button
          onClick={() => setShowCancelSheet(true)}
          className="w-full mt-3 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-red-400 active:opacity-70 transition-opacity"
        >
          <X size={14} strokeWidth={2} />
          Cancel ride
        </button>
      </motion.div>

      <HindiVoiceHint active={!!currentStep} />

      {/* Voice-mute — the one remaining bottom-right utility button, above the sheet. */}
      <VoiceToggleButton style={{ bottom: 'calc(env(safe-area-inset-bottom) + 250px)', left: 'auto', right: '16px' }} />

      {/* Re-center chip — appears once a manual drag drops auto-follow */}
      <AnimatePresence>
        {mapMode === 'nav' && !following && (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: EASE }}
            onClick={handleRecenter}
            className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full px-4 py-2 active:scale-95 transition-transform"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 250px)', zIndex: 40, ...GLASS }}
          >
            <Locate size={14} className="text-primary" />
            <span className="text-text-primary text-[13px] font-semibold">Re-center</span>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCancelSheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-end"
          >
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => { if (!cancellingRide) setShowCancelSheet(false) }}
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
                <h3 className="text-base font-black text-text-primary">Cancel this ride?</h3>
                <button
                  onClick={() => setShowCancelSheet(false)}
                  disabled={cancellingRide}
                  className="w-8 h-8 rounded-full bg-surface-3 flex items-center justify-center active:scale-95 transition-transform"
                >
                  <X size={15} className="text-text-secondary" />
                </button>
              </div>
              <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-2.5">Why are you cancelling?</p>
              <div className="space-y-2 mb-5">
                {[
                  { code: 'passenger_not_found', label: 'Passenger not at pickup' },
                  { code: 'vehicle_breakdown',   label: 'Vehicle breakdown' },
                  { code: 'wrong_booking',        label: 'Wrong booking details' },
                  { code: 'emergency',            label: 'Emergency' },
                  { code: 'other',                label: 'Other reason' },
                ].map(r => (
                  <button
                    key={r.code}
                    onClick={() => setCancelReason(r.code)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left active:scale-[0.98] transition-transform ${
                      cancelReason === r.code ? '' : 'bg-surface-2'
                    }`}
                    style={cancelReason === r.code
                      ? { background: 'rgba(239,68,68,0.07)', border: '1.5px solid rgba(239,68,68,0.40)' }
                      : { border: '1.5px solid #E2E8F0' }
                    }
                  >
                    <div
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={cancelReason === r.code
                        ? { border: '5px solid #EF4444' }
                        : { border: '2px solid #CBD5E1' }
                      }
                    />
                    <span className={`text-sm font-medium ${cancelReason === r.code ? 'text-accent-red' : 'text-text-secondary'}`}>
                      {r.label}
                    </span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => void handleCancelRide()}
                disabled={!cancelReason || cancellingRide}
                className="w-full py-3.5 rounded-2xl text-sm font-bold text-text-inverse mb-2.5 disabled:opacity-40 active:scale-[0.98] transition-transform"
                style={{ background: '#EF4444' }}
              >
                {cancellingRide ? 'Cancelling…' : 'Confirm cancellation'}
              </button>
              <button
                onClick={() => setShowCancelSheet(false)}
                disabled={cancellingRide}
                className="w-full py-3 rounded-2xl text-sm font-semibold text-text-secondary disabled:opacity-50 active:scale-[0.98] transition-transform bg-surface-2 border border-border"
              >
                Keep my ride
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
