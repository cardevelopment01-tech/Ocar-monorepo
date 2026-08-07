import { useEffect, useRef, useState, useCallback, lazy, Suspense } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Navigation2, RotateCcw, Clock, Check } from 'lucide-react'
import OcarSpinner from './OcarSpinner'
import { useDriverLocation } from '@/lib/useDriverLocation'
import { driverRideApi } from '@/lib/ride-api'

const DriverMapView     = lazy(() => import('@/components/map/DriverMapView'))
const LocationPin       = lazy(() => import('@/components/map/LocationPin'))
const SelfCarMarker     = lazy(() => import('@/components/map/SelfCarMarker'))
const RoutePolyline     = lazy(() => import('@/components/map/RoutePolyline'))
const FitBoundsToPoints = lazy(() => import('@/components/map/FitBoundsToPoints'))

// Named palette for this screen's deliberately dark, high-contrast surface
// (an "incoming call" moment — outdoor/bright-sunlight legibility, distinct
// from the rest of the light Ocar surface). Centralized so the ~30 repeated
// hex literals this card used are named once instead of copy-pasted.
const C = {
  surface:      '#0F172A',
  panel:        '#1E293B',
  text:         '#F8FAFC',
  textMuted:    '#94A3B8',
  textFaint:    '#64748B',
  divider:      '#475569',
  primary:      '#0A9FB0',
  danger:       '#EF4444',
  warning:      '#F59E0B',
  warningText:  '#FDE68A',
  warningSub:   '#D97706',
  info:         '#0EA5E9',
  infoText:     '#BAE6FD',
  infoSub:      '#7DD3FC',
  violet:       '#A78BFA',
  rental:       '#A5B4FC',
} as const

interface TripRequestCardProps {
  pickup: string
  drop: string
  pickupDistance: number
  tripDistance: number
  fare: number
  timeRemaining: number
  rideType: string
  rideCategoryName?: string
  tripHours?: number
  returnAt?: string
  stopCount?: number
  pickupLat: number
  pickupLng: number
  isAccepting?: boolean
  /** Accept succeeded — show the confirmation beat before the screen navigates away. */
  accepted?: boolean
  /** Accept failed (ride taken by another driver) — shake + toast, then dismiss. */
  failed?: boolean
  onAccept: () => void
  onDecline: () => void
}

const RIDE_TYPE_BADGE: Record<string, { label: string; bg: string; color: string } | undefined> = {
  round_trip: { label: 'Return',  bg: 'rgba(245,158,11,0.18)', color: C.warningSub },
  rental:     { label: 'Rental',  bg: 'rgba(14,165,233,0.15)',  color: C.info },
}

export default function TripRequestCard({
  pickup, drop, pickupDistance, tripDistance, fare,
  timeRemaining: initialTime, rideType, rideCategoryName, tripHours, returnAt, stopCount,
  pickupLat, pickupLng, isAccepting, accepted, failed, onAccept, onDecline,
}: TripRequestCardProps) {
  const [time, setTime] = useState(initialTime)
  const [expired, setExpired] = useState(false)
  const expireTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickedAt5s = useRef(false)

  const handleExpire = useCallback(() => {
    setExpired(true)
    expireTimeoutRef.current = setTimeout(onDecline, 1200)
  }, [onDecline])

  useEffect(() => {
    try { navigator.vibrate([180, 80, 180]) } catch (_) {}
    const id = setInterval(() => {
      setTime(t => {
        if (t === 6 && !tickedAt5s.current) { tickedAt5s.current = true; try { navigator.vibrate(50) } catch (_) {} }
        if (t <= 1) { clearInterval(id); handleExpire(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => {
      clearInterval(id)
      if (expireTimeoutRef.current) clearTimeout(expireTimeoutRef.current)
    }
  }, [handleExpire])

  // Vibrate once on accept success — the confirmation beat before the screen
  // navigates away (App.tsx holds the sheet mounted briefly for this).
  useEffect(() => {
    if (accepted) { try { navigator.vibrate(80) } catch (_) {} }
  }, [accepted])

  const isUrgent = time <= 5
  const reduce = useReducedMotion()

  // Driver's own live position, purely for the pickup-preview map — this
  // component only mounts while a request is showing, so a short-lived
  // low-frequency watch here is fine (no onSync, nothing uploaded).
  const { position } = useDriverLocation()

  const pickupPos: [number, number] = [pickupLat, pickupLng]
  const [previewPolyline, setPreviewPolyline] = useState<string | undefined>(undefined)
  const fetchedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!position) return
    const key = `${pickupLat},${pickupLng}`
    if (fetchedFor.current === key) return
    fetchedFor.current = key
    driverRideApi.getRoute(position[0], position[1], pickupLat, pickupLng)
      .then(r => { if (r.polyline) setPreviewPolyline(r.polyline) })
      .catch(() => {})
  }, [position, pickupLat, pickupLng])

  // Cheap fallback so the request never waits on a network fetch: a straight
  // line to the pickup until the real route resolves (or if it never does).
  // ponytail: no fade-in on the polyline swap (native Maps overlay, not a DOM
  // node) — it just pops in; add a crossfade if this reads as jarring in practice.
  const fallbackPositions: [number, number][] | undefined = position
    ? [position, [(position[0] + pickupLat) / 2, (position[1] + pickupLng) / 2], pickupPos]
    : undefined

  const etaMin = tripDistance > 0 ? Math.max(1, Math.round(tripDistance / 0.6)) : 0
  const etaToPickupMin = pickupDistance > 0 ? Math.max(1, Math.round(pickupDistance / 0.6)) : 0
  const returnAtFormatted = returnAt
    ? new Date(returnAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    : null
  const ringColor = failed ? C.danger
    : isUrgent ? C.danger
    : rideType === 'round_trip' ? C.warning
    : rideType === 'rental' ? C.info
    : C.primary
  const ringPct = failed ? 100 : Math.max(0, Math.min(100, (time / initialTime) * 100))

  const childVar = reduce
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.15 } } }
    : { hidden: { opacity: 0, y: 8 },
        show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const } } }
  const containerVar = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.05, delayChildren: reduce ? 0 : 0.12 } },
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[200]"
    >
      {/* Map layer — spatial context behind the sheet instead of a flat dim */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <Suspense fallback={<div className="w-full h-full" style={{ background: C.surface }} />}>
          <DriverMapView initialCenter={position ?? pickupPos} zoom={14}>
            <FitBoundsToPoints points={[position, pickupPos]} padding={{ top: 70, bottom: 380, left: 36, right: 36 }} />
            {previewPolyline
              ? <RoutePolyline encoded={previewPolyline} />
              : fallbackPositions && <RoutePolyline positions={fallbackPositions} />}
            {position && <SelfCarMarker position={position} />}
            <LocationPin position={pickupPos} variant="pickup" />
          </DriverMapView>
        </Suspense>
      </div>

      {/* Scrim: gives the top of the map legibility without hiding it */}
      <div
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{ height: '42%', background: 'linear-gradient(180deg, rgba(8,11,22,0.72) 0%, rgba(8,11,22,0) 100%)', zIndex: 1 }}
      />

      <motion.div
        initial={reduce ? { opacity: 0 } : { y: '100%' }}
        animate={reduce ? { opacity: 1 } : { y: 0 }}
        exit={reduce ? { opacity: 0 } : { y: '100%' }}
        transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 280, damping: 32, mass: 0.9 }}
        className="absolute bottom-0 left-0 right-0 w-full max-w-[430px] mx-auto rounded-t-3xl overflow-hidden"
        style={{
          zIndex: 2,
          background: C.surface,
          boxShadow: isUrgent
            ? '0 -10px 60px rgba(239,68,68,0.28), 0 -2px 0 rgba(248,250,252,0.04)'
            : '0 -10px 50px rgba(0,0,0,0.55), 0 -1px 0 rgba(248,250,252,0.06)',
          transition: 'box-shadow 250ms ease-out',
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3.5 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.14)' }} />
        </div>

        <motion.div variants={containerVar} initial="hidden" animate="show">

          {/* [1] Header: title, badges only — the clock lives in the accept ring now */}
          <motion.div variants={childVar} className="flex items-center justify-between px-5 pt-3 pb-2">
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-[15px] font-semibold flex-shrink-0" style={{ color: C.text }}>
                {rideType === 'round_trip' ? 'Round trip' : rideType === 'rental' ? 'Rental request' : 'Trip request'}
              </p>
              {RIDE_TYPE_BADGE[rideType] && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: RIDE_TYPE_BADGE[rideType]!.bg, color: RIDE_TYPE_BADGE[rideType]!.color }}
                >
                  {RIDE_TYPE_BADGE[rideType]!.label}
                </span>
              )}
              {rideCategoryName && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: 'rgba(10,159,176,0.18)', color: C.primary }}
                >
                  {rideCategoryName} ride
                </span>
              )}
            </div>
            {!!stopCount && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ background: 'rgba(220, 62, 147,0.18)', color: C.violet }}
              >
                {stopCount} {stopCount === 1 ? 'stop' : 'stops'}
              </span>
            )}
          </motion.div>

          {/* [2] ETA-to-pickup hero — the #1 accept factor, now above the fare */}
          <motion.div variants={childVar} className="px-5 pb-2 flex items-center gap-1.5">
            <Navigation2 size={13} style={{ color: C.textMuted }} />
            <span className="text-[15px] font-bold tabular-nums" style={{ color: C.text }}>
              {etaToPickupMin} min
            </span>
            <span className="text-[13px] font-medium" style={{ color: C.textMuted }}>
              · {pickupDistance.toFixed(1)} km away
            </span>
          </motion.div>

          {/* [3] Fare hero + trip meta */}
          <motion.div variants={childVar} className="px-5 pb-5">
            <div className="flex items-baseline gap-2 min-h-[36px]">
              <span
                className="text-[34px] font-extrabold tracking-tight tabular-nums leading-none"
                style={{ color: C.text }}
              >
                ₹{fare}
              </span>
              {tripDistance > 0 ? (
                <span className="text-[13px] font-medium" style={{ color: C.textMuted }}>
                  <span style={{ color: C.divider }} className="px-1.5">·</span>{tripDistance} km
                  <span style={{ color: C.divider }} className="px-1.5">·</span>~{etaMin} min
                </span>
              ) : (
                <span className="text-[13px] font-medium" style={{ color: C.textFaint }}>
                  <span className="px-1.5">·</span>calculating…
                </span>
              )}
            </div>
          </motion.div>

          {/* [4] Route: raised panel, monochrome rail, no halo/gradient/icon tile */}
          <motion.div variants={childVar} className="px-5 pb-5">
            <div className="rounded-2xl px-4 py-4" style={{ background: C.panel }}>
              <div className="flex gap-3.5">
                {/* Connector rail */}
                <div className="flex flex-col items-center w-2.5 flex-shrink-0 pt-1.5">
                  {/* pickup: clean white dot with ring */}
                  <div
                    className="w-[7px] h-[7px] rounded-full flex-shrink-0"
                    style={{ background: C.text, boxShadow: '0 0 0 2px rgba(248,250,252,0.25)' }}
                  />
                  {/* line: indigo desaturating to slate */}
                  <div
                    className="flex-1 w-0.5 my-1.5 rounded-full"
                    style={{ minHeight: 28, background: `linear-gradient(180deg,${C.primary} 0%,${C.divider} 100%)` }}
                  />
                  {/* drop: indigo filled circle */}
                  <div className="w-[9px] h-[9px] rounded-full flex-shrink-0" style={{ background: C.primary }} />
                </div>

                {/* Address rows */}
                <div className="flex-1 min-w-0 flex flex-col gap-4">
                  <div>
                    <p className="text-[15px] font-semibold leading-snug truncate" style={{ color: C.text }}>{pickup}</p>
                    <p className="text-[11px] font-medium uppercase tracking-wide mt-0.5" style={{ color: C.textFaint }}>Pickup</p>
                  </div>
                  <div>
                    <p className="text-[15px] font-semibold leading-snug truncate" style={{ color: rideType === 'rental' ? C.rental : C.text }}>
                      {rideType === 'rental' ? 'Hourly rental' : drop}
                    </p>
                    <p className="text-[11px] font-medium uppercase tracking-wide mt-0.5" style={{ color: C.textFaint }}>
                      {rideType === 'rental' ? 'Flexible route' : rideType === 'round_trip' ? 'Drop · return' : 'Drop'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* [4.5] Ride type disclosure band, round_trip / rental only */}
          {(rideType === 'round_trip' || rideType === 'rental') && (
            <motion.div variants={childVar} className="px-5 pb-4">
              {rideType === 'round_trip' && (
                <div
                  className="flex items-start gap-3 rounded-xl px-3.5 py-3"
                  style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.22)' }}
                >
                  <RotateCcw size={14} style={{ color: C.warning, flexShrink: 0, marginTop: 2 }} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold leading-tight" style={{ color: C.warningText }}>
                      Outstation return trip
                    </p>
                    <p className="text-[12px] font-medium mt-0.5 leading-snug" style={{ color: C.warningSub }}>
                      {returnAtFormatted
                        ? `Must return by ${returnAtFormatted}`
                        : 'You must drive back to the pickup point'}
                    </p>
                  </div>
                </div>
              )}
              {rideType === 'rental' && (
                <div
                  className="flex items-start gap-3 rounded-xl px-3.5 py-3"
                  style={{ background: 'rgba(14,165,233,0.10)', border: '1px solid rgba(14,165,233,0.20)' }}
                >
                  <Clock size={14} style={{ color: C.info, flexShrink: 0, marginTop: 2 }} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold leading-tight" style={{ color: C.infoText }}>
                      {tripHours ? `${tripHours}-hour rental` : 'Hourly rental'}
                    </p>
                    <p className="text-[12px] font-medium mt-0.5 leading-snug" style={{ color: C.infoSub }}>
                      Stay with the passenger for the full duration
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* Failure toast — ride taken by another driver */}
          <AnimatePresence>
            {failed && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mx-5 mb-3 rounded-xl px-3.5 py-2.5 text-center text-[13px] font-semibold"
                style={{ background: 'rgba(239,68,68,0.14)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.28)' }}
              >
                Ride no longer available
              </motion.div>
            )}
          </AnimatePresence>

          {/* [5] Actions: 30/70, accept-dominant, countdown ring wraps the Accept button */}
          <motion.div
            variants={childVar}
            animate={failed && !reduce ? { x: [0, -8, 8, -8, 8, 0] } : { x: 0 }}
            transition={failed ? { duration: 0.3 } : undefined}
            className="flex gap-3 px-5 pt-1 pb-8"
          >
            <button
              onClick={onDecline}
              disabled={!!accepted || !!failed}
              className="w-[112px] h-14 rounded-2xl font-semibold text-[15px] flex-shrink-0 active:scale-[0.97] transition-transform duration-150 disabled:opacity-40"
              style={{ background: C.panel, color: C.textMuted, border: '1px solid rgba(255,255,255,0.08)' }}
            >
              Decline
            </button>

            {/* Ring: conic-gradient border that drains with `time`, turns red + pulses under 5s.
                Timer and accept target are now one visual object, matching how Uber/Ola
                pair the countdown with the action itself. */}
            <div
              className="flex-1 h-14 rounded-2xl p-[3px]"
              style={{
                background: `conic-gradient(${ringColor} ${ringPct}%, rgba(255,255,255,0.12) ${ringPct}%)`,
                transition: 'background 250ms ease-out',
              }}
            >
              <motion.button
                onClick={onAccept}
                disabled={expired || isAccepting || accepted || failed}
                animate={!reduce && isUrgent && !isAccepting && !accepted && !failed ? { scale: [1, 1.02, 1] } : { scale: 1 }}
                transition={{ duration: 0.6, repeat: isUrgent && !reduce ? Infinity : 0, ease: 'easeInOut' }}
                whileTap={reduce ? undefined : { scale: 0.97 }}
                className="w-full h-full rounded-[13px] font-extrabold text-[15px] disabled:opacity-90 flex items-center justify-center gap-2 overflow-hidden"
                style={{
                  background: accepted ? '#16A34A' : C.primary,
                  color: C.text,
                  transition: 'background 200ms ease-out',
                }}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {accepted ? (
                    <motion.span
                      key="accepted"
                      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85, filter: 'blur(3px)' }}
                      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                      transition={{ duration: reduce ? 0.01 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                      className="flex items-center gap-2"
                    >
                      <Check size={16} strokeWidth={2.5} aria-hidden="true" /> Accepted
                    </motion.span>
                  ) : isAccepting ? (
                    <motion.span
                      key="accepting"
                      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85, filter: 'blur(3px)' }}
                      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                      transition={{ duration: reduce ? 0.01 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                      className="flex items-center gap-2"
                    >
                      <OcarSpinner size={16} variant="white" /> Accepting…
                    </motion.span>
                  ) : (
                    <motion.span
                      key="accept"
                      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85, filter: 'blur(3px)' }}
                      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                      transition={{ duration: reduce ? 0.01 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                      className="flex items-center gap-2"
                    >
                      <Check size={16} strokeWidth={2.5} aria-hidden="true" /> Accept · ₹{fare} · {time}s
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>
          </motion.div>

        </motion.div>
      </motion.div>
    </motion.div>
  )
}
