import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Navigation, Phone, RotateCcw, Clock, X } from 'lucide-react'
import SOSButton from '@/components/ui/SOSButton'
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

const DriverMapView  = lazy(() => import('@/components/map/DriverMapView'))
const RecenterMap    = lazy(() => import('@/components/map/RecenterMap'))
const LocationPin    = lazy(() => import('@/components/map/LocationPin'))
const SelfCarMarker  = lazy(() => import('@/components/map/SelfCarMarker'))
const RoutePolyline  = lazy(() => import('@/components/map/RoutePolyline'))
const TrafficLayer   = lazy(() => import('@/components/map/TrafficLayer'))
const TrafficColoredRoute = lazy(() => import('@/components/map/TrafficColoredRoute'))

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245

export default function NavigateToPickup() {
  const navigate = useNavigate()
  const { activeRide, restoreChecked, updateRideStatus, clearRide } = useRideStore()
  const { sessionId } = useSessionStore()
  const [arriving, setArriving] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [showCancelSheet,  setShowCancelSheet]  = useState(false)
  const [cancelReason,     setCancelReason]     = useState<string | null>(null)
  const [cancellingRide,   setCancellingRide]   = useState(false)

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
      navigate('/ride/otp', { replace: true })
    } catch {
      setError('Failed to mark arrival. Please try again.')
    } finally {
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
          <DriverMapView initialCenter={mapCenter} zoom={15} mapId={import.meta.env.VITE_GOOGLE_MAPS_DARK_MAP_ID}>
            <TrafficLayer />
            <RecenterMap
              center={mapCenter}
              heading={selfHeading}
              topPadding={100}
              bottomPadding={220}
              pitch={50}
              distanceToManeuver={distanceToManeuver}
            />
            <RoutePolyline encoded={encodedPolyline} variant="pickup-leg" />
            <TrafficColoredRoute encoded={trafficPolyline} intervals={trafficIntervals} />
            {position && <SelfCarMarker position={position} />}
            <LocationPin position={pickupPos} variant="pickup" />
          </DriverMapView>
        </Suspense>
      </div>

      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 px-4"
        style={{ zIndex: 10, paddingTop: 'calc(max(env(safe-area-inset-top), 2.5rem) + 56px)' }}
      >
        <AnimatePresence>
          {(currentStep || isReconnecting || source !== 'google') && (
            <motion.div
              key="maneuver"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="mb-2"
            >
              <ManeuverBanner step={currentStep} distanceMetres={distanceToManeuver} isReconnecting={isReconnecting} source={source} />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={GLASS}>
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
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-surface-3 border border-border flex items-center justify-center flex-shrink-0">
              <span className="text-primary font-bold text-base">{avatarLetter}</span>
            </div>
            <div>
              <p className="text-text-muted text-xs">Rider</p>
              <p className="text-text-primary font-bold">{activeRide?.userName ?? 'Rider'}</p>
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

        <button
          onClick={handleArrived}
          disabled={arriving}
          className="btn-go w-full active:scale-95 transition-transform"
          style={{ minHeight: 56 }}
        >
          {arriving ? 'Marking arrival…' : 'Arrived at Pickup'}
        </button>

        <button
          onClick={() => setShowCancelSheet(true)}
          className="w-full mt-3 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-red-400 active:opacity-70 transition-opacity"
        >
          <X size={14} strokeWidth={2} />
          Cancel ride
        </button>
      </motion.div>

      <SOSButton
        rideId={activeRide?.id ?? ''}
        onSOS={handleSOS}
        style={{ top: 'max(env(safe-area-inset-top), 1rem)', right: '16px', bottom: 'auto', zIndex: 50 }}
      />
      <VoiceToggleButton style={{ bottom: '100px', left: '16px' }} />
      <HindiVoiceHint active={!!currentStep} />

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
              className="relative w-full rounded-t-3xl px-5 pt-5 bg-white"
              style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}
            >
              <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-4" />
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-black text-gray-900">Cancel this ride?</h3>
                <button
                  onClick={() => setShowCancelSheet(false)}
                  disabled={cancellingRide}
                  className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center active:scale-95 transition-transform"
                >
                  <X size={15} className="text-gray-500" />
                </button>
              </div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2.5">Why are you cancelling?</p>
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
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left active:scale-[0.98] transition-transform"
                    style={cancelReason === r.code
                      ? { background: 'rgba(220,38,38,0.07)', border: '1.5px solid rgba(220,38,38,0.40)' }
                      : { background: '#F8FAFC', border: '1.5px solid #E2E8F0' }
                    }
                  >
                    <div
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={cancelReason === r.code
                        ? { border: '5px solid #DC2626' }
                        : { border: '2px solid #CBD5E1' }
                      }
                    />
                    <span className={`text-sm font-medium ${cancelReason === r.code ? 'text-red-700' : 'text-gray-700'}`}>
                      {r.label}
                    </span>
                  </button>
                ))}
              </div>
              <button
                onClick={handleCancelRide}
                disabled={!cancelReason || cancellingRide}
                className="w-full py-3.5 rounded-2xl text-sm font-bold text-white mb-2.5 disabled:opacity-40 active:scale-[0.98] transition-transform"
                style={{ background: '#DC2626' }}
              >
                {cancellingRide ? 'Cancelling…' : 'Confirm cancellation'}
              </button>
              <button
                onClick={() => setShowCancelSheet(false)}
                disabled={cancellingRide}
                className="w-full py-3 rounded-2xl text-sm font-semibold text-gray-700 disabled:opacity-50 active:scale-[0.98] transition-transform"
                style={{ background: '#F1F5F9', border: '1px solid #E2E8F0' }}
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
