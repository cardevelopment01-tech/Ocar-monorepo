import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { MapPin, Navigation2 } from 'lucide-react'
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
  timeRemaining: initialTime, onAccept, onDecline,
}: TripRequestCardProps) {
  const [time, setTime] = useState(initialTime)
  const [expired, setExpired] = useState(false)

  const handleExpire = useCallback(() => {
    setExpired(true)
    setTimeout(onDecline, 1200)
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
    return () => clearInterval(id)
  }, [handleExpire])

  const isUrgent = time <= 5
  const progress = (time / initialTime) * 100
  const circumference = 2 * Math.PI * 30

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end"
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)' }}
    >
      <motion.div
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300, mass: 0.85 }}
        className="w-full max-w-[430px] mx-auto rounded-t-3xl overflow-hidden"
        style={{
          background: '#FFFFFF',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.14)',
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-0">
          <div className="w-9 h-1 rounded-full bg-border" />
        </div>

        {/* Header + countdown */}
        <div className="flex items-center justify-between px-5 pt-4 pb-4" style={{ borderBottom: '1px solid #F1F5F9' }}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-0.5">New Ride Request</p>
            <p className={cn('text-base font-bold', isUrgent ? 'text-accent-red' : 'text-text-primary')}>
              {expired ? 'Request expired' : isUrgent ? 'Hurry up!' : 'Respond quickly'}
            </p>
          </div>

          {/* Circular timer */}
          <div className="relative w-[68px] h-[68px] flex items-center justify-center">
            <svg className="absolute inset-0 -rotate-90" width="68" height="68" aria-hidden="true">
              <circle cx="34" cy="34" r="30" fill="none" stroke="#F1F5F9" strokeWidth="4" />
              <circle
                cx="34" cy="34" r="30" fill="none"
                stroke={isUrgent ? '#EF4444' : '#F97316'}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - progress / 100)}
                className="transition-all duration-1000"
              />
            </svg>
            <span className={cn(
              'text-[32px] font-black tabular-nums leading-none',
              isUrgent ? 'text-accent-red' : 'text-accent-orange'
            )}>
              {time}
            </span>
          </div>
        </div>

        {/* Route */}
        <div className="px-5 py-4" style={{ borderBottom: '1px solid #F1F5F9' }}>
          <div className="flex gap-3">
            <div className="flex flex-col items-center pt-1 flex-shrink-0 w-4">
              <div className="w-2.5 h-2.5 rounded-full bg-accent-orange flex-shrink-0" />
              <div className="w-px flex-1 my-1.5 bg-border" />
              <MapPin size={12} className="text-primary flex-shrink-0" />
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <p className="text-text-primary font-semibold text-[15px] leading-snug">{pickup}</p>
                <p className="text-text-muted text-xs mt-0.5">{pickupDistance.toFixed(1)} km away</p>
              </div>
              <div>
                <p className="text-text-primary font-semibold text-[15px] leading-snug">{drop}</p>
                <p className="text-text-muted text-xs mt-0.5">
                  {tripDistance > 0 ? `${tripDistance} km trip` : 'Calculating…'}
                </p>
              </div>
            </div>
            <div className="flex-shrink-0">
              <div
                className="flex items-center gap-1 rounded-xl px-2.5 py-1.5"
                style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.18)' }}
              >
                <Navigation2 size={10} className="text-primary" />
                <span className="text-primary text-xs font-bold">{pickupDistance.toFixed(1)} km</span>
              </div>
            </div>
          </div>
        </div>

        {/* Fare */}
        <div className="px-5 py-4 mb-1">
          <div
            className="flex items-center justify-between rounded-2xl px-5 py-4"
            style={{
              background: 'linear-gradient(135deg, #FFF7ED 0%, #FFF1E6 100%)',
              border: '1px solid rgba(249,115,22,0.18)',
            }}
          >
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 mb-0.5">Estimated Fare</p>
              <p className="text-[40px] font-black text-accent-orange leading-none tabular-nums">₹{fare}</p>
            </div>
            <div className="text-right">
              <p className="text-text-muted text-xs">Trip distance</p>
              <p className="text-text-secondary font-bold text-sm mt-0.5">
                {tripDistance > 0 ? `${tripDistance} km` : '—'}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-5 pb-10 pt-1">
          <button
            onClick={onDecline}
            className="btn-secondary flex-1"
            style={{ minHeight: 56 }}
          >
            Decline
          </button>
          <button
            onClick={onAccept}
            disabled={expired}
            className="btn-go-online flex-1"
            style={{ minHeight: 56 }}
          >
            Accept
          </button>
        </div>
      </motion.div>
    </div>
  )
}
