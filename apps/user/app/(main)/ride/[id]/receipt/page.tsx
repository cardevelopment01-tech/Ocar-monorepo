'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ChevronLeft, CheckCircle2, XCircle, Navigation, Clock, Star, LifeBuoy } from 'lucide-react'
import { rideApi, type RideDetail } from '@/lib/ride-api'

const EASE = [0.22, 1, 0.36, 1] as const

function getInitials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function money(v: string | null): string | null {
  const n = v != null ? parseFloat(v) : null
  return n && n > 0 ? `₹${Math.round(n).toLocaleString('en-IN')}` : null
}

const FARE_LINES: { key: 'base_fare' | 'distance_fare' | 'time_fare' | 'stop_fare' | 'hour_surcharge' | 'surge_fare' | 'overage_fare'; label: string }[] = [
  { key: 'base_fare',      label: 'Base fare' },
  { key: 'distance_fare',  label: 'Distance' },
  { key: 'time_fare',      label: 'Time' },
  { key: 'stop_fare',      label: 'Stops' },
  { key: 'hour_surcharge', label: 'Hour surcharge' },
  { key: 'surge_fare',     label: 'Surge' },
  { key: 'overage_fare',   label: 'Overage' },
]

export default function RideReceiptPage() {
  const params = useParams<{ id: string }>()
  const rideId = params?.id ?? ''
  const router = useRouter()

  const [ride, setRide]       = useState<RideDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!rideId) return
    rideApi.getRide(rideId).then(setRide).catch(() => {}).finally(() => setLoading(false))
  }, [rideId])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
      </div>
    )
  }

  if (!ride) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <p className="text-sm font-semibold text-text-primary">Trip not found</p>
        <button type="button" onClick={() => router.replace('/history')} className="text-primary text-sm font-semibold">
          Back to My Rides
        </button>
      </div>
    )
  }

  const isCancelled  = ride.status === 'cancelled' || ride.status === 'no_drivers'
  const isCompleted  = ride.status === 'completed'
  const total        = money(ride.total_final) ?? money(ride.total_estimated)
  const totalLabel    = ride.total_final ? 'Final fare' : 'Estimated fare'
  const distanceKm    = ride.actual_km  != null ? parseFloat(ride.actual_km)  : null
  const durationMin   = ride.actual_min != null ? parseFloat(ride.actual_min) : null

  return (
    <div className="h-full flex flex-col bg-background overflow-y-auto scrollbar-none">
      {/* Header */}
      <div className="flex-shrink-0 bg-surface border-b border-border pt-safe-top">
        <div className="flex items-center gap-3 px-4 pt-4 pb-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-surface-2 flex-shrink-0"
          >
            <ChevronLeft size={18} className="text-text-primary" />
          </button>
          <h1 className="text-lg font-bold text-text-primary">Trip details</h1>
        </div>
      </div>

      <div className="flex-1 px-4 pt-4 pb-8 space-y-3">
        {/* Status */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className={`flex items-center gap-3 rounded-2xl p-4 ${isCancelled ? 'bg-status-error/10' : 'bg-status-success/10'}`}
        >
          {isCancelled ? (
            <XCircle size={22} className="text-status-error flex-shrink-0" />
          ) : (
            <CheckCircle2 size={22} className="text-status-success flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-bold ${isCancelled ? 'text-status-error' : 'text-status-success'}`}>
              {ride.status === 'no_drivers' ? 'No drivers were available' : isCancelled ? 'Trip cancelled' : 'Trip completed'}
            </p>
            <p className="text-xs text-text-muted mt-0.5">{fmtDateTime(ride.requested_at)}</p>
          </div>
          {total && !isCancelled && <p className="text-lg font-black text-text-primary">{total}</p>}
        </motion.div>

        {/* Route */}
        <div className="bg-surface rounded-2xl border border-border p-4">
          <div className="flex gap-3">
            <div className="flex flex-col items-center gap-0.5 flex-shrink-0 pt-1.5">
              <span className="w-2 h-2 rounded-full bg-primary" />
              <span className="w-px flex-1 bg-border min-h-[24px]" />
              <span className="w-2 h-2 rounded-full bg-text-primary" />
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">Pickup</p>
                <p className="text-sm font-medium text-text-primary">{ride.origin_address ?? '—'}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">Drop</p>
                <p className="text-sm font-medium text-text-primary">{ride.destination_address ?? '—'}</p>
              </div>
            </div>
          </div>
          {(distanceKm != null || durationMin != null) && (
            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
              {distanceKm != null && (
                <div className="flex items-center gap-1.5">
                  <Navigation size={12} className="text-text-muted" />
                  <span className="text-xs text-text-secondary font-medium">{distanceKm.toFixed(1)} km</span>
                </div>
              )}
              {durationMin != null && (
                <div className="flex items-center gap-1.5">
                  <Clock size={12} className="text-text-muted" />
                  <span className="text-xs text-text-secondary font-medium">{Math.round(durationMin)} min</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Driver */}
        {ride.driver_name && (
          <div className="bg-surface rounded-2xl border border-border p-4 flex items-center gap-3">
            {ride.driver_photo ? (
              <img
                src={ride.driver_photo}
                alt={ride.driver_name}
                className="w-11 h-11 rounded-2xl object-cover flex-shrink-0"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 text-white text-sm font-black bg-gradient-primary">
                {getInitials(ride.driver_name)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-text-primary">{ride.driver_name}</p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                {ride.driver_rating && (
                  <>
                    <Star size={11} className="fill-status-warning text-status-warning" />
                    <span className="text-xs font-semibold text-text-secondary">{Number(ride.driver_rating).toFixed(1)}</span>
                  </>
                )}
                {(ride.vehicle_model || ride.vehicle_name) && (
                  <span className="text-xs text-text-muted">
                    {ride.driver_rating && '· '}
                    {[ride.vehicle_color, ride.vehicle_model ?? ride.vehicle_name].filter(Boolean).join(' ')}
                  </span>
                )}
              </div>
            </div>
            {ride.vehicle_number_plate && (
              <span className="text-[11px] font-bold tracking-wider text-text-secondary bg-surface-2 border border-border rounded px-1.5 py-0.5 flex-shrink-0">
                {ride.vehicle_number_plate}
              </span>
            )}
          </div>
        )}

        {/* Fare breakdown or cancellation reason */}
        {isCancelled ? (
          ride.cancellation_reason && (
            <div className="bg-surface rounded-2xl border border-border p-4">
              <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">Cancellation reason</p>
              <p className="text-sm text-text-primary">{ride.cancellation_reason}</p>
            </div>
          )
        ) : (
          <div className="bg-surface rounded-2xl border border-border p-4">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-3">{totalLabel} breakdown</p>
            <div className="space-y-2">
              {FARE_LINES.map(({ key, label }) => {
                const amount = money(ride[key])
                if (!amount) return null
                return (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">{label}</span>
                    <span className="text-text-primary font-medium">{amount}</span>
                  </div>
                )
              })}
              <div className="flex items-center justify-between pt-2 mt-1 border-t border-border">
                <span className="text-sm font-bold text-text-primary">Total</span>
                <span className="text-base font-black text-text-primary">{total ?? '—'}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex-shrink-0 px-4 pb-8 space-y-2">
        {isCompleted && (
          ride.user_rating_given != null ? (
            <div className="w-full flex items-center justify-center gap-1.5 bg-surface-2 text-text-secondary text-sm font-semibold py-3.5 rounded-full">
              <Star size={15} className="fill-status-warning text-status-warning" />
              You rated this trip {ride.user_rating_given}/5
            </div>
          ) : (
            <button
              type="button"
              onClick={() => router.push(`/ride/${rideId}/rate`)}
              className="w-full flex items-center justify-center gap-2 bg-primary text-white text-sm font-semibold py-3.5 rounded-full shadow-button active:scale-[0.98] transition-transform"
            >
              <Star size={15} />
              Rate this trip
            </button>
          )
        )}
        <button
          type="button"
          onClick={() => router.push('/help')}
          className="w-full flex items-center justify-center gap-2 bg-surface-2 text-text-secondary text-sm font-semibold py-3.5 rounded-full active:scale-[0.98] transition-transform"
        >
          <LifeBuoy size={15} />
          Need help with this trip?
        </button>
      </div>
    </div>
  )
}
