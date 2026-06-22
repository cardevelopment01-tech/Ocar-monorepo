import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { MapPin, Navigation2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TripRequestCardProps {
  pickup: string
  drop: string
  pickupDistance: number
  tripDistance: number
  fare: number
  timeRemaining: number
  isAccepting?: boolean
  onAccept: () => void
  onDecline: () => void
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
  timeRemaining: initialTime, isAccepting, onAccept, onDecline,
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
  const barFill =
    isUrgent ? 'linear-gradient(90deg,#F87171,#EF4444)'
    : time <= 10 ? '#F97316'
    : 'linear-gradient(90deg,#FB923C,#F97316)'
  const childVar = reduce
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.15 } } }
    : { hidden: { opacity: 0, y: 8, filter: 'blur(4px)' },
        show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const } } }
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
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)' }}
    >
      <motion.div
        initial={reduce ? { opacity: 0 } : { y: '100%' }}
        animate={reduce ? { opacity: 1 } : { y: 0 }}
        exit={reduce ? { opacity: 0 } : { y: '100%' }}
        transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 }}
        className="relative w-full max-w-[430px] mx-auto rounded-t-3xl overflow-hidden"
        style={{
          background: '#FFFFFF',
          boxShadow: isUrgent
            ? '0 -8px 44px rgba(239,68,68,0.18)'
            : '0 -8px 40px rgba(0,0,0,0.14)',
          transition: 'box-shadow 250ms ease-out',
        }}
      >
        {/* [1] Linear timer bar — full bleed, drains left as time runs out */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-border z-10">
          <motion.div
            className="h-full rounded-r-full"
            style={{ background: barFill }}
            animate={{ width: `${Math.max(0, (time / initialTime) * 100)}%` }}
            transition={{ duration: reduce ? 0 : 1, ease: 'linear' }}
          />
        </div>

        {/* Drag handle */}
        <div className="flex justify-center pt-3.5 pb-1">
          <div className="w-9 h-1 rounded-full bg-border" />
        </div>

        <motion.div variants={containerVar} initial="hidden" animate="show">

          {/* [2] Header row — title + live clock + pickup-distance chip */}
          <motion.div
            variants={childVar}
            className="flex items-center justify-between px-5 pt-3 pb-4"
          >
            <div className="flex items-baseline gap-2.5 min-w-0">
              <p className="text-[15px] font-semibold text-text-primary">Trip request</p>
              <motion.span
                animate={!reduce && isUrgent ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                transition={{ duration: 1, repeat: isUrgent && !reduce ? Infinity : 0, ease: 'easeInOut' }}
                className={cn(
                  'text-[15px] font-bold tabular-nums origin-left',
                  isUrgent ? 'text-accent-red' : 'text-text-muted'
                )}
              >
                {expired ? 'expired' : clock}
              </motion.span>
            </div>

            <div
              className="flex items-center gap-1 rounded-full px-2.5 py-1.5 flex-shrink-0"
              style={{ background: '#EFF6FF', border: '1px solid #DBEAFE' }}
            >
              <Navigation2 size={11} className="text-primary" />
              <span className="text-primary text-xs font-bold tabular-nums">
                {pickupDistance.toFixed(1)} km away
              </span>
            </div>
          </motion.div>

          {/* [3] Fare + trip meta — inline row, not a hero-card */}
          <motion.div variants={childVar} className="px-5 pb-4">
            <div className="flex items-baseline gap-2 min-h-[34px]">
              <span className="text-[28px] font-extrabold text-text-primary tracking-tight tabular-nums leading-none">
                ₹{fare}
              </span>
              {tripDistance > 0 ? (
                <span className="text-[13px] font-medium text-text-secondary">
                  <span className="text-text-muted px-1.5">·</span>{tripDistance} km trip
                  <span className="text-text-muted px-1.5">·</span>~{etaMin} min
                </span>
              ) : (
                <span className="text-[13px] font-medium text-text-muted">
                  <span className="px-1.5">·</span>calculating…
                </span>
              )}
            </div>
          </motion.div>

          {/* [4] Route — spatial connector with orange→blue gradient rail */}
          <motion.div variants={childVar} className="px-5 pb-5">
            <div className="flex gap-3">
              {/* Connector rail */}
              <div className="flex flex-col items-center w-5 flex-shrink-0">
                {/* origin node — orange filled dot in soft halo */}
                <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: '#FFF7ED' }}>
                  <div className="w-3 h-3 rounded-full bg-accent-orange" />
                </div>
                {/* gradient line + mid-distance pill */}
                <div className="relative flex-1 w-0.5 my-1" style={{ background: 'linear-gradient(180deg,#F97316 0%,#2563EB 100%)' }}>
                  {tripDistance > 0 && (
                    <span
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-semibold text-text-secondary px-1.5"
                      style={{ background: '#FFFFFF' }}
                    >
                      {tripDistance} km
                    </span>
                  )}
                </div>
                {/* destination node — square tile with MapPin */}
                <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: '#EFF6FF' }}>
                  <MapPin size={13} className="text-primary" />
                </div>
              </div>

              {/* Address rows */}
              <div className="flex-1 min-w-0 flex flex-col justify-between gap-5 py-0.5">
                <div>
                  <p className="text-[15px] font-semibold text-text-primary leading-snug truncate">{pickup}</p>
                  <p className="text-xs text-text-muted mt-0.5">Pickup</p>
                </div>
                <div>
                  <p className="text-[15px] font-semibold text-text-primary leading-snug truncate">{drop}</p>
                  <p className="text-xs text-text-muted mt-0.5">Drop</p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* [5] Actions — asymmetric 30/70, accept-dominant */}
          <motion.div variants={childVar} className="flex gap-3 px-5 pt-1 pb-8">
            <button
              onClick={onDecline}
              className="w-[112px] h-14 rounded-2xl font-semibold text-[15px] text-text-secondary border border-border flex-shrink-0 active:scale-[0.97] transition-transform duration-150"
              style={{ background: '#F0F4FD' }}
            >
              Decline
            </button>
            <motion.button
              onClick={onAccept}
              disabled={expired || isAccepting}
              whileTap={reduce ? undefined : { scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              className="btn-primary flex-1 h-14 disabled:opacity-60"
            >
              {isAccepting ? 'Accepting…' : `Accept · ₹${fare}`}
            </motion.button>
          </motion.div>

        </motion.div>
      </motion.div>
    </motion.div>
  )
}
