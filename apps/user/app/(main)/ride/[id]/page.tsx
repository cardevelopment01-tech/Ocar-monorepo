'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Phone, MessageSquare, X, MapPin, Clock, Star } from 'lucide-react'
import dynamic from 'next/dynamic'
import { mockPickup, mockDrop, mockRoute, mockDriver } from '@/lib/mock-data'
import { useRouter } from 'next/navigation'

const RideMapScene = dynamic(() => import('@/components/map/RideMapScene'), { ssr: false })

type RideState = 'searching' | 'accepted' | 'in_progress' | 'completed'

const STATE_STEPS: Record<RideState, number> = {
  searching: 0,
  accepted: 1,
  in_progress: 2,
  completed: 3,
}

export default function RidePage() {
  const router = useRouter()
  const [state, setState] = useState<RideState>('searching')

  // Simulate state progression for demo
  useEffect(() => {
    const t1 = setTimeout(() => setState('accepted'), 3000)
    const t2 = setTimeout(() => setState('in_progress'), 8000)
    const t3 = setTimeout(() => setState('completed'), 15000)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])

  useEffect(() => {
    if (state === 'completed') {
      setTimeout(() => router.push('/ride/mock-ride-001/rate'), 1500)
    }
  }, [state, router])

  const center: [number, number] = [
    (mockPickup.lat + mockDrop.lat) / 2,
    (mockPickup.lng + mockDrop.lng) / 2,
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Map */}
      <div className="relative flex-1">
        <RideMapScene
          center={center}
          pickupPos={[mockPickup.lat, mockPickup.lng]}
          dropPos={[mockDrop.lat, mockDrop.lng]}
          route={mockRoute}
          driverPos={state !== 'searching' ? [mockDriver.lat, mockDriver.lng] : undefined}
          driverHeading={45}
        />

        {/* Status pill */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
          <motion.div
            key={state}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-surface rounded-full shadow-float px-4 py-2"
          >
            {state === 'searching' && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-status-warning animate-pulse-soft" />
                <span className="text-sm font-semibold text-text-primary">Finding a driver…</span>
              </div>
            )}
            {state === 'accepted' && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary" />
                <span className="text-sm font-semibold text-text-primary">Driver is on the way</span>
              </div>
            )}
            {state === 'in_progress' && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-status-success animate-pulse-soft" />
                <span className="text-sm font-semibold text-text-primary">En route to destination</span>
              </div>
            )}
            {state === 'completed' && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-status-success">Ride complete ✓</span>
              </div>
            )}
          </motion.div>
        </div>
      </div>

      {/* Bottom sheet */}
      <AnimatePresence mode="wait">
        <motion.div
          key={state}
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-surface rounded-t-3xl shadow-sheet px-4 pt-4 pb-safe-bottom"
        >
          <div className="w-10 h-1 bg-border rounded-full mx-auto mb-4" />

          {state === 'searching' ? (
            <div className="flex flex-col items-center py-4 gap-3">
              <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
              <p className="text-text-secondary text-sm">Looking for nearby drivers</p>
              <button
                onClick={() => router.back()}
                className="mt-2 text-status-error text-sm font-medium"
              >
                Cancel ride
              </button>
            </div>
          ) : (
            <>
              {/* Driver info */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-background overflow-hidden flex-shrink-0">
                  <div className="w-full h-full bg-primary-subtle flex items-center justify-center text-2xl">
                    👤
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-text-primary">{mockDriver.name}</p>
                  <div className="flex items-center gap-1 text-xs text-text-muted">
                    <Star size={11} className="fill-status-warning text-status-warning" />
                    <span>{mockDriver.rating}</span>
                    <span>· {mockDriver.vehicle}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="w-10 h-10 bg-background rounded-full flex items-center justify-center">
                    <Phone size={16} className="text-primary" />
                  </button>
                  <button className="w-10 h-10 bg-background rounded-full flex items-center justify-center">
                    <MessageSquare size={16} className="text-primary" />
                  </button>
                </div>
              </div>

              {/* Plate number */}
              <div className="bg-background rounded-2xl px-4 py-3 flex items-center justify-between mb-4">
                <span className="text-xs text-text-muted">Vehicle number</span>
                <span className="font-bold text-text-primary tracking-widest">{mockDriver.plate}</span>
              </div>

              {/* Route summary */}
              <div className="space-y-2 mb-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                  <div>
                    <p className="text-xs text-text-muted">Pickup</p>
                    <p className="text-sm font-medium text-text-primary">{mockPickup.label}</p>
                  </div>
                </div>
                <div className="ml-[5px] w-px h-4 bg-border" />
                <div className="flex items-start gap-3">
                  <div className="mt-1 w-2 h-2 rounded-full bg-text-primary flex-shrink-0" />
                  <div>
                    <p className="text-xs text-text-muted">Drop</p>
                    <p className="text-sm font-medium text-text-primary">{mockDrop.label}</p>
                  </div>
                </div>
              </div>

              {/* ETA */}
              {state === 'accepted' && (
                <div className="flex items-center gap-2 bg-primary-subtle rounded-2xl px-4 py-3">
                  <Clock size={16} className="text-primary" />
                  <span className="text-sm font-semibold text-primary">Arriving in ~4 min</span>
                </div>
              )}
              {state === 'in_progress' && (
                <div className="flex items-center gap-2 bg-background rounded-2xl px-4 py-3">
                  <MapPin size={16} className="text-status-success" />
                  <span className="text-sm font-semibold text-text-primary">3.2 km remaining</span>
                </div>
              )}
            </>
          )}

          <div className="h-4" />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
