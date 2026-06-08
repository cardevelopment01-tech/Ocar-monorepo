import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Star, ArrowRight } from 'lucide-react'
import { mockIncomingRequest, mockDriver } from '@/lib/mock-data'

export default function TripEnd() {
  const navigate = useNavigate()
  const confettiFired = useRef(false)

  // simple green flash on mount
  useEffect(() => {
    if (confettiFired.current) return
    confettiFired.current = true
  }, [])

  const commission = Math.round(mockIncomingRequest.fare * 0.2)
  const net = mockIncomingRequest.fare - commission

  return (
    <div className="min-h-screen bg-bg text-text-primary px-5 py-10 flex flex-col">
      {/* Success badge */}
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 15 }}
        className="flex flex-col items-center mb-8"
      >
        <div
          className="w-24 h-24 rounded-full bg-primary flex items-center justify-center mb-4"
          style={{ boxShadow: '0 0 60px rgba(34,197,94,0.4)' }}
        >
          <span className="text-5xl">✓</span>
        </div>
        <h1 className="text-text-primary font-black text-3xl">Trip Complete!</h1>
        <p className="text-text-secondary text-sm mt-1">
          {mockIncomingRequest.pickup} → {mockIncomingRequest.drop}
        </p>
      </motion.div>

      {/* Earnings breakdown */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="bg-surface rounded-3xl border border-border p-5 mb-4"
        style={{ borderTopColor: '#22C55E', borderTopWidth: 3 }}
      >
        <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-3">You Earned</p>
        <p className="text-[48px] font-black text-primary leading-none mb-4">₹{net}</p>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Ride fare</span>
            <span className="text-text-primary font-semibold">₹{mockIncomingRequest.fare}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Platform commission (20%)</span>
            <span className="text-accent-red font-semibold">-₹{commission}</span>
          </div>
          <div className="border-t border-border pt-2 flex justify-between text-sm">
            <span className="text-text-primary font-bold">Net earnings</span>
            <span className="text-primary font-black">₹{net}</span>
          </div>
        </div>
      </motion.div>

      {/* Trip stats */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="bg-surface rounded-3xl border border-border p-5 mb-4"
      >
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-text-primary font-black text-xl">{mockIncomingRequest.tripDistance} km</p>
            <p className="text-text-muted text-xs">Distance</p>
          </div>
          <div className="text-center border-x border-border">
            <div className="flex items-center justify-center gap-1">
              <Star size={14} className="text-accent-amber fill-accent-amber" />
              <p className="text-text-primary font-black text-xl">{mockDriver.rating}</p>
            </div>
            <p className="text-text-muted text-xs">Your rating</p>
          </div>
          <div className="text-center">
            <p className="text-text-primary font-black text-xl">{mockDriver.totalTrips + 1}</p>
            <p className="text-text-muted text-xs">Total trips</p>
          </div>
        </div>
      </motion.div>

      <div className="flex-1" />

      <motion.button
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        onClick={() => navigate('/')}
        className="btn-go w-full flex items-center justify-center gap-2"
        style={{ minHeight: 56 }}
      >
        Back to Home <ArrowRight size={18} />
      </motion.button>
    </div>
  )
}
