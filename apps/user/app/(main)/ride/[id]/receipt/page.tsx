'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ChevronDown, ChevronLeft, CheckCircle2, XCircle, Navigation, Clock, Star, LifeBuoy, AlertCircle } from 'lucide-react'
import { rideApi, type RideDetail } from '@/lib/ride-api'
import { openRidePaymentCheckout } from '@/lib/razorpay-checkout'
import { DriverRow, driverViewFromRide } from '@/components/ride/DriverIdentity'

const EASE = [0.22, 1, 0.36, 1] as const

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function money(v: string | null | undefined): string | null {
  const n = v != null ? parseFloat(v) : null
  return n && n > 0 ? `₹${Math.round(n).toLocaleString('en-IN')}` : null
}

const FARE_LINES: { key: 'base_fare' | 'distance_fare' | 'time_fare' | 'stop_fare' | 'hour_surcharge' | 'waiting_fare' | 'surge_fare' | 'overage_fare'; label: string }[] = [
  { key: 'base_fare',      label: 'Base fare' },
  { key: 'distance_fare',  label: 'Distance' },
  { key: 'time_fare',      label: 'Time' },
  { key: 'stop_fare',      label: 'Stops' },
  { key: 'hour_surcharge', label: 'Driver allowance' },
  // Hourly round trips: the booked hours are their own line, not an unexplained remainder.
  { key: 'waiting_fare',   label: 'Booked time' },
  { key: 'surge_fare',     label: 'Surge' },
  { key: 'overage_fare',   label: 'Overage' },
]

// Quiet second line under a receipt label (quantity), same wording as the rider app.
function fareDetail(key: string, ride: RideDetail): string | null {
  if (key === 'distance_fare' && ride.actual_km) return `${parseFloat(ride.actual_km)} km`
  if (key === 'time_fare' && ride.actual_min) return `${Math.round(parseFloat(ride.actual_min))} min`
  if (key === 'waiting_fare' && ride.trip_hours) return `${ride.trip_hours} ${ride.trip_hours === 1 ? 'hour' : 'hours'}`
  return null
}

const clock = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()

// Only a round trip that ran past its booked window has a breakdown; start = booked end minus booked hours.
function timeline(ride: RideDetail) {
  if (!ride.bookedUntil || !ride.trip_hours || !ride.completed_at || (ride.overtimeMin ?? 0) <= 0) return null
  const end = new Date(ride.bookedUntil)
  const grace = ride.overtimeGraceMin ?? 0
  return [
    { time: clock(new Date(end.getTime() - ride.trip_hours * 3_600_000)), label: 'Trip started', note: null },
    { time: clock(end), label: 'Booked time ended', note: grace > 0 ? `${grace} free minutes` : null },
    { time: clock(new Date(end.getTime() + grace * 60_000)), label: 'Extra time started', note: ride.overtimeRate ? `₹${ride.overtimeRate} an hour` : null },
    { time: clock(new Date(ride.completed_at)), label: 'Trip ended', note: `${ride.overtimeMin} min extra` },
  ]
}

export default function RideReceiptPage() {
  const params = useParams<{ id: string }>()
  const rideId = params?.id ?? ''
  const router = useRouter()

  const [ride, setRide]       = useState<RideDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [payMsg, setPayMsg]     = useState<string | null>(null)

  useEffect(() => {
    if (!rideId) return
    rideApi.getRide(rideId).then(setRide).catch(() => {}).finally(() => setLoading(false))
  }, [rideId])

  const needsPayment =
    (ride?.payment_status === 'pending' || ride?.payment_status === 'failed') &&
    (ride?.payment_channel === 'online' || ride?.payment_channel === 'wallet')

  async function handleRetryPayment() {
    if (!rideId) return
    setRetrying(true)
    setPayMsg(null)
    try {
      const result = await rideApi.retryPayment(rideId)
      if (result.channel === 'online') {
        if (result.order) {
          await openRidePaymentCheckout(rideId, result.order, () => {
            rideApi.getRide(rideId).then(setRide).catch(() => {})
          })
        } else {
          // dev auto-confirmed (no Razorpay keys) — refresh to clear the banner
          const fresh = await rideApi.getRide(rideId)
          setRide(fresh)
        }
      } else if (result.paid) {
        const fresh = await rideApi.getRide(rideId)
        setRide(fresh)
      } else {
        setPayMsg('Not enough wallet balance. Top up your wallet and try again.')
      }
    } catch {
      setPayMsg('Could not start payment. Please try again.')
    } finally {
      setRetrying(false)
    }
  }

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

        {needsPayment && (
          <div className="rounded-2xl bg-status-warning/10 p-4">
            <div className="flex items-center gap-3">
              <AlertCircle size={20} className="text-status-warning flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-status-warning">
                  {ride?.payment_status === 'failed' ? 'Payment failed' : 'Payment pending'}
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  {ride?.payment_channel === 'wallet'
                    ? 'Your wallet payment for this trip is incomplete.'
                    : 'Your online payment for this trip didn’t go through.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRetryPayment()}
                disabled={retrying}
                className="flex-shrink-0 bg-primary text-white text-xs font-semibold px-4 py-2 rounded-full active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {retrying ? 'Processing…' : 'Pay now'}
              </button>
            </div>
            {payMsg && <p className="text-xs text-status-error mt-2">{payMsg}</p>}
          </div>
        )}

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
                <p className="text-xs text-text-secondary">Pickup</p>
                <p className="text-sm font-medium text-text-primary">{ride.origin_address ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary">Drop</p>
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

        {ride.rider_name && (
          <p className="text-xs font-semibold text-violet-600">Booked for {ride.rider_name}</p>
        )}

        {/* Driver */}
        {ride.driver_name && (
          <div className="bg-surface rounded-2xl border border-border p-4">
            <DriverRow view={driverViewFromRide(ride)} photo={ride.driver_photo} />
          </div>
        )}

        {/* Fare breakdown or cancellation reason */}
        {isCancelled ? (
          ride.cancellation_reason && (
            <div className="bg-surface rounded-2xl border border-border p-4">
              <p className="text-xs text-text-secondary mb-1">Cancellation reason</p>
              <p className="text-sm text-text-primary">{ride.cancellation_reason}</p>
            </div>
          )
        ) : (
          <div className="bg-surface rounded-2xl border border-border p-4">
            <p className="text-sm font-semibold text-text-primary mb-3">Fare receipt</p>
            <div className="space-y-3">
              {FARE_LINES.map(({ key, label }) => {
                const amount = money(ride[key])
                if (!amount) return null
                const detail = fareDetail(key, ride)
                return (
                  <div key={key} className="flex items-start justify-between gap-3 text-sm">
                    <div>
                      <p className="text-text-primary">{label}</p>
                      {detail && <p className="text-xs text-text-secondary">{detail}</p>}
                    </div>
                    <span className="text-text-primary font-semibold tabular-nums">{amount}</span>
                  </div>
                )
              })}
              {/* After surge: overtime is not surged. Only present when the trip ran past the booked window. */}
              {(ride.overtimeMin ?? 0) > 0 && ride.overtimeFare != null && (
                <div className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <p className="text-text-primary">Extra time</p>
                    <p className="text-xs text-text-secondary">
                      {ride.overtimeMin} min{ride.overtimeGraceMin ? `, after ${ride.overtimeGraceMin} free minutes` : ''}
                    </p>
                  </div>
                  <span className="text-text-primary font-semibold tabular-nums">₹{ride.overtimeFare.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                </div>
              )}
              {(() => {
                const waitTotal = (ride.stops ?? []).reduce((s, st) => s + parseFloat(st.wait_charge ?? '0'), 0)
                return waitTotal > 0 ? (
                  <div className="flex items-start justify-between gap-3 text-sm">
                    <p className="text-text-primary">Waiting at stops</p>
                    <span className="text-text-primary font-semibold tabular-nums">₹{Math.round(waitTotal).toLocaleString('en-IN')}</span>
                  </div>
                ) : null
              })()}
              <div className="flex items-baseline justify-between pt-3 border-t border-border">
                <span className="text-base font-bold text-text-primary">{totalLabel === 'Final fare' ? 'Total' : 'Estimated total'}</span>
                <span className="text-xl font-bold text-text-primary tabular-nums">{total ?? '—'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Time breakdown: only exists when a round trip ran past its booked window. */}
        {isCompleted && timeline(ride) && (
          <details className="bg-surface rounded-2xl border border-border group">
            <summary className="flex items-center justify-between min-h-[48px] px-4 text-sm font-semibold text-text-primary cursor-pointer list-none">
              Time breakdown
              <ChevronDown size={18} className="text-text-secondary transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-4 pb-4 space-y-3">
              {timeline(ride)!.map((step) => (
                <div key={step.label} className="flex gap-3 text-sm">
                  <span className="w-[72px] flex-shrink-0 font-semibold text-text-primary tabular-nums">{step.time}</span>
                  <div>
                    <p className="text-text-primary">{step.label}</p>
                    {step.note && <p className="text-xs text-text-secondary">{step.note}</p>}
                  </div>
                </div>
              ))}
            </div>
          </details>
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
          onClick={() => router.push(`/help?rideId=${rideId}`)}
          className="w-full flex items-center justify-center gap-2 bg-surface-2 text-text-secondary text-sm font-semibold py-3.5 rounded-full active:scale-[0.98] transition-transform"
        >
          <LifeBuoy size={15} />
          Need help with this trip?
        </button>
      </div>
    </div>
  )
}
