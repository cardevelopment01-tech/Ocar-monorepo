import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Navigation2, RotateCcw, Clock } from 'lucide-react'

interface TripRequestCardProps {
  pickup: string
  drop: string
  pickupDistance: number
  tripDistance: number
  fare: number
  timeRemaining: number
  rideType: string
  tripHours?: number
  returnAt?: string
  stopCount?: number
  isAccepting?: boolean
  onAccept: () => void
  onDecline: () => void
}

const RIDE_TYPE_BADGE: Record<string, { label: string; bg: string; color: string } | undefined> = {
  round_trip: { label: 'Return',  bg: 'rgba(245,158,11,0.18)', color: '#D97706' },
  rental:     { label: 'Rental',  bg: 'rgba(14,165,233,0.15)',  color: '#0EA5E9' },
}

function beep() {
  try {
    const ctx = new AudioContext()
    const play = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.25, ctx.currentTime + start)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
      osc.start(ctx.currentTime + start)
      osc.stop(ctx.currentTime + start + dur)
    }
    play(880, 0, 0.12); play(1100, 0.18, 0.12); play(880, 0.36, 0.12)
  } catch (_) {}
}

export default function TripRequestCard({
  pickup, drop, pickupDistance, tripDistance, fare,
  timeRemaining: initialTime, rideType, tripHours, returnAt, stopCount, isAccepting, onAccept, onDecline,
}: TripRequestCardProps) {
  const [time, setTime] = useState(initialTime)
  const [expired, setExpired] = useState(false)
  const expireTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleExpire = useCallback(() => {
    setExpired(true)
    expireTimeoutRef.current = setTimeout(onDecline, 1200)
  }, [onDecline])

  useEffect(() => {
    beep()
    try { navigator.vibrate([180, 80, 180]) } catch (_) {}
    const id = setInterval(() => {
      setTime(t => {
        if (t <= 1) { clearInterval(id); handleExpire(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => {
      clearInterval(id)
      if (expireTimeoutRef.current) clearTimeout(expireTimeoutRef.current)
    }
  }, [handleExpire])

  const isUrgent = time <= 5

  const reduce = useReducedMotion()
  const clock = `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`
  const etaMin = tripDistance > 0 ? Math.max(1, Math.round(tripDistance / 0.6)) : 0
  const returnAtFormatted = returnAt
    ? new Date(returnAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    : null
  const barFill = isUrgent ? '#EF4444'
    : rideType === 'round_trip' ? '#F59E0B'
    : rideType === 'rental' ? '#0EA5E9'
    : '#4F46E5'
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
      className="fixed inset-0 z-[200] flex items-end"
      style={{ background: 'rgba(8,11,22,0.62)', backdropFilter: 'blur(8px)' }}
    >
      <motion.div
        initial={reduce ? { opacity: 0 } : { y: '100%' }}
        animate={reduce ? { opacity: 1 } : { y: 0 }}
        exit={reduce ? { opacity: 0 } : { y: '100%' }}
        transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 280, damping: 32, mass: 0.9 }}
        className="relative w-full max-w-[430px] mx-auto rounded-t-3xl overflow-hidden"
        style={{
          background: '#0F172A',
          boxShadow: isUrgent
            ? '0 -10px 60px rgba(239,68,68,0.28), 0 -2px 0 rgba(248,250,252,0.04)'
            : '0 -10px 50px rgba(0,0,0,0.55), 0 -1px 0 rgba(248,250,252,0.06)',
          transition: 'box-shadow 250ms ease-out',
        }}
      >
        {/* [1] Timer bar, flat color, drains left */}
        <div className="absolute top-0 left-0 right-0 h-1 z-10" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <motion.div
            className="h-full rounded-r-full"
            style={{ background: barFill, transition: 'background 250ms ease-out' }}
            animate={{ width: `${Math.max(0, (time / initialTime) * 100)}%` }}
            transition={{ duration: reduce ? 0 : 1, ease: 'linear' }}
          />
        </div>

        {/* Drag handle */}
        <div className="flex justify-center pt-3.5 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.14)' }} />
        </div>

        <motion.div variants={containerVar} initial="hidden" animate="show">

          {/* [2] Header: title, badge, clock, quiet distance */}
          <motion.div variants={childVar} className="flex items-center justify-between px-5 pt-3 pb-4">
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-[15px] font-semibold flex-shrink-0" style={{ color: '#F8FAFC' }}>
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
              <motion.span
                animate={!reduce && isUrgent ? { scale: [1, 1.1, 1] } : { scale: 1 }}
                transition={{ duration: 1, repeat: isUrgent && !reduce ? Infinity : 0, ease: 'easeInOut' }}
                className="text-[15px] font-bold tabular-nums origin-left"
                style={{ color: isUrgent ? '#EF4444' : '#94A3B8' }}
              >
                {expired ? 'expired' : clock}
              </motion.span>
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {!!stopCount && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: 'rgba(124,58,237,0.18)', color: '#A78BFA' }}
                >
                  {stopCount} {stopCount === 1 ? 'stop' : 'stops'}
                </span>
              )}
              <Navigation2 size={12} style={{ color: '#94A3B8' }} />
              <span className="text-[13px] font-semibold tabular-nums" style={{ color: '#94A3B8' }}>
                {pickupDistance.toFixed(1)} km away
              </span>
            </div>
          </motion.div>

          {/* [3] Fare hero + trip meta */}
          <motion.div variants={childVar} className="px-5 pb-5">
            <div className="flex items-baseline gap-2 min-h-[36px]">
              <span
                className="text-[34px] font-extrabold tracking-tight tabular-nums leading-none"
                style={{ color: '#F8FAFC' }}
              >
                ₹{fare}
              </span>
              {tripDistance > 0 ? (
                <span className="text-[13px] font-medium" style={{ color: '#94A3B8' }}>
                  <span style={{ color: '#475569' }} className="px-1.5">·</span>{tripDistance} km
                  <span style={{ color: '#475569' }} className="px-1.5">·</span>~{etaMin} min
                </span>
              ) : (
                <span className="text-[13px] font-medium" style={{ color: '#64748B' }}>
                  <span className="px-1.5">·</span>calculating…
                </span>
              )}
            </div>
          </motion.div>

          {/* [4] Route: raised panel, monochrome rail, no halo/gradient/icon tile */}
          <motion.div variants={childVar} className="px-5 pb-5">
            <div className="rounded-2xl px-4 py-4" style={{ background: '#1E293B' }}>
              <div className="flex gap-3.5">
                {/* Connector rail */}
                <div className="flex flex-col items-center w-2.5 flex-shrink-0 pt-1.5">
                  {/* pickup: clean white dot with ring */}
                  <div
                    className="w-[7px] h-[7px] rounded-full flex-shrink-0"
                    style={{ background: '#F8FAFC', boxShadow: '0 0 0 2px rgba(248,250,252,0.25)' }}
                  />
                  {/* line: indigo desaturating to slate */}
                  <div
                    className="flex-1 w-0.5 my-1.5 rounded-full"
                    style={{ minHeight: 28, background: 'linear-gradient(180deg,#4F46E5 0%,#475569 100%)' }}
                  />
                  {/* drop: indigo filled circle */}
                  <div className="w-[9px] h-[9px] rounded-full flex-shrink-0" style={{ background: '#4F46E5' }} />
                </div>

                {/* Address rows */}
                <div className="flex-1 min-w-0 flex flex-col gap-4">
                  <div>
                    <p className="text-[15px] font-semibold leading-snug truncate" style={{ color: '#F8FAFC' }}>{pickup}</p>
                    <p className="text-[11px] font-medium uppercase tracking-wide mt-0.5" style={{ color: '#64748B' }}>Pickup</p>
                  </div>
                  <div>
                    <p className="text-[15px] font-semibold leading-snug truncate" style={{ color: rideType === 'rental' ? '#A5B4FC' : '#F8FAFC' }}>
                      {rideType === 'rental' ? 'Hourly rental' : drop}
                    </p>
                    <p className="text-[11px] font-medium uppercase tracking-wide mt-0.5" style={{ color: '#64748B' }}>
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
                  <RotateCcw size={14} style={{ color: '#F59E0B', flexShrink: 0, marginTop: 2 }} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold leading-tight" style={{ color: '#FDE68A' }}>
                      Outstation return trip
                    </p>
                    <p className="text-[12px] font-medium mt-0.5 leading-snug" style={{ color: '#D97706' }}>
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
                  <Clock size={14} style={{ color: '#0EA5E9', flexShrink: 0, marginTop: 2 }} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold leading-tight" style={{ color: '#BAE6FD' }}>
                      {tripHours ? `${tripHours}-hour rental` : 'Hourly rental'}
                    </p>
                    <p className="text-[12px] font-medium mt-0.5 leading-snug" style={{ color: '#7DD3FC' }}>
                      Stay with the passenger for the full duration
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* [5] Actions: 30/70, accept-dominant bright-on-dark */}
          <motion.div variants={childVar} className="flex gap-3 px-5 pt-1 pb-8">
            <button
              onClick={onDecline}
              className="w-[112px] h-14 rounded-2xl font-semibold text-[15px] flex-shrink-0 active:scale-[0.97] transition-transform duration-150"
              style={{ background: '#1E293B', color: '#94A3B8', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              Decline
            </button>
            <motion.button
              onClick={onAccept}
              disabled={expired || isAccepting}
              whileTap={reduce ? undefined : { scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              className="flex-1 h-14 rounded-2xl font-extrabold text-[15px] disabled:opacity-60"
              style={{
                background: '#4F46E5',
                color: '#F8FAFC',
                boxShadow: '0 8px 24px rgba(79,70,229,0.40)',
              }}
            >
              {isAccepting ? 'Accepting…' : `Accept · ₹${fare}`}
            </motion.button>
          </motion.div>

        </motion.div>
      </motion.div>
    </motion.div>
  )
}
