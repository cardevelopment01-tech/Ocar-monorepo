'use client'

import { CheckCircle2, MapPin, Clock, ArrowRight } from 'lucide-react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { mockPickup, mockDrop, mockVehicles } from '@/lib/mock-data'

export default function BookingConfirmedPage() {
  const router = useRouter()
  const vehicle = mockVehicles[0]

  return (
    <div className="min-h-screen bg-background flex flex-col px-6 pb-safe-bottom">
      <div className="flex-1 flex flex-col items-center justify-center text-center pt-12">
        <motion.div
          initial={{ scale: 0, rotate: -90 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 0.1 }}
          className="mb-6"
        >
          <CheckCircle2 size={72} className="text-status-success" strokeWidth={1.5} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          <h1 className="text-2xl font-bold text-text-primary mb-2">Booking Confirmed!</h1>
          <p className="text-text-muted text-sm mb-8">Your {vehicle.name} is being assigned</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="w-full card text-left mb-4"
        >
          <div className="text-3xl text-center mb-3">{vehicle.emoji}</div>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="mt-1 w-2.5 h-2.5 rounded-full bg-primary flex-shrink-0" />
              <div>
                <p className="text-xs text-text-muted">Pickup</p>
                <p className="text-sm font-semibold text-text-primary">{mockPickup.label}</p>
              </div>
            </div>
            <div className="ml-[5px] w-px h-4 bg-border" />
            <div className="flex items-start gap-3">
              <div className="mt-1 w-2.5 h-2.5 rounded-full bg-text-primary flex-shrink-0" />
              <div>
                <p className="text-xs text-text-muted">Drop</p>
                <p className="text-sm font-semibold text-text-primary">{mockDrop.label}</p>
              </div>
            </div>
          </div>

          <div className="flex gap-3 mt-4 pt-4 border-t border-border">
            <div className="flex-1 text-center">
              <p className="text-xs text-text-muted">Fare</p>
              <p className="font-bold text-text-primary">₹{vehicle.price}</p>
            </div>
            <div className="w-px bg-border" />
            <div className="flex-1 text-center">
              <p className="text-xs text-text-muted">Distance</p>
              <p className="font-bold text-text-primary">6.4 km</p>
            </div>
            <div className="w-px bg-border" />
            <div className="flex-1 text-center">
              <p className="text-xs text-text-muted">ETA</p>
              <p className="font-bold text-text-primary">~18 min</p>
            </div>
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="pb-6"
      >
        <button
          onClick={() => router.push('/ride/mock-ride-001')}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          Track ride <ArrowRight size={18} />
        </button>
      </motion.div>
    </div>
  )
}
