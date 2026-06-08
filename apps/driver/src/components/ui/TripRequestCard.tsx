import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface TripRequestCardProps {
  pickup: string
  drop: string
  pickupDistance: number
  tripDistance: number
  fare: number
  timeRemaining: number
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
      gain.gain.setValueAtTime(0.3, ctx.currentTime + start)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
      osc.start(ctx.currentTime + start)
      osc.stop(ctx.currentTime + start + dur)
    }
    play(880, 0,    0.15)
    play(1100, 0.2, 0.15)
    play(880, 0.4,  0.15)
  } catch (_) { /* audio not available */ }
}

export default function TripRequestCard({
  pickup, drop, pickupDistance, tripDistance, fare,
  timeRemaining: initialTime, onAccept, onDecline,
}: TripRequestCardProps) {
  const [time, setTime] = useState(initialTime)
  const [expired, setExpired] = useState(false)

  const handleExpire = useCallback(() => {
    setExpired(true)
    setTimeout(onDecline, 1500)
  }, [onDecline])

  useEffect(() => {
    beep()
    try { navigator.vibrate([200, 100, 200]) } catch (_) {}

    const id = setInterval(() => {
      setTime(t => {
        if (t <= 1) { clearInterval(id); handleExpire(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [handleExpire])

  const isUrgent = time <= 5
  const progress = (time / initialTime) * 100

  return (
    <div className="fixed inset-0 z-[200] flex items-end" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="w-full max-w-[430px] mx-auto bg-surface rounded-t-3xl pb-10"
      >
        {/* Countdown header */}
        <div className="flex flex-col items-center pt-5 pb-4 px-5 border-b border-border">
          <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-3">New Ride Request</p>

          {/* Circular progress */}
          <div className="relative w-20 h-20 flex items-center justify-center mb-1">
            <svg className="absolute inset-0 -rotate-90" width="80" height="80">
              <circle cx="40" cy="40" r="34" fill="none" stroke="#1E2433" strokeWidth="5" />
              <circle
                cx="40" cy="40" r="34" fill="none"
                stroke={isUrgent ? '#EF4444' : '#22C55E'}
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 34}`}
                strokeDashoffset={`${2 * Math.PI * 34 * (1 - progress / 100)}`}
                className="transition-all duration-1000"
              />
            </svg>
            <span className={cn('text-[40px] font-bold tabular-nums leading-none', isUrgent ? 'text-accent-red' : 'text-primary')}>
              {time}
            </span>
          </div>

          {expired && <p className="text-accent-red text-sm font-semibold mt-1">Request expired</p>}
        </div>

        {/* Route info */}
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="mt-1 w-3 h-3 rounded-full bg-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-text-primary font-bold text-lg leading-tight">{pickup}</p>
              <p className="text-text-secondary text-sm mt-0.5">{pickupDistance} km away</p>
            </div>
          </div>

          <div className="ml-[5px] border-l-2 border-dashed border-border h-4" />

          <div className="flex items-start gap-3">
            <div className="mt-1 w-3 h-3 rounded-full bg-accent-red flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-text-primary font-bold text-lg leading-tight">{drop}</p>
              <p className="text-text-secondary text-sm mt-0.5">{tripDistance} km trip</p>
            </div>
          </div>
        </div>

        {/* Fare */}
        <div className="mx-5 bg-primary-subtle rounded-2xl px-5 py-4 mb-5">
          <p className="text-text-muted text-xs mb-1">Estimated fare</p>
          <p className="text-[40px] font-bold text-primary leading-none">₹{fare}</p>
        </div>

        {/* Buttons */}
        <div className="flex gap-3 px-5">
          <button onClick={onDecline} className="btn-secondary-dark flex-1" style={{ minHeight: 56 }}>
            Decline
          </button>
          <button
            onClick={onAccept}
            disabled={expired}
            className="btn-go flex-1 animate-pulse-green"
            style={{ minHeight: 56 }}
          >
            Accept
          </button>
        </div>
      </motion.div>
    </div>
  )
}
