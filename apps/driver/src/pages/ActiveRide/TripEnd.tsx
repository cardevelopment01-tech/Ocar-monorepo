import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Star, ArrowRight, RotateCcw, Clock, MapPin, Check, X } from 'lucide-react'
import { useRideStore } from '@/store/useRideStore'
import { useSessionStore } from '@/store/useSessionStore'
import { useAuthStore } from '@/store/useAuthStore'
import { fmtReturn } from '@/lib/constants'
import { driverSafetyApi, type RatingTag } from '@/lib/safety-api'
import { driverRideApi } from '@/lib/ride-api'

function fmt(n: number) {
  const s = n.toFixed(2)
  return s.endsWith('.00') ? s.slice(0, -3) : s
}

export default function TripEnd() {
  const navigate = useNavigate()
  const confettiFired = useRef(false)
  const { activeRide, clearRide } = useRideStore()
  const { setOnline, sessionId, vehicleId, categoryId } = useSessionStore()
  const driver = useAuthStore(s => s.driver)

  const fare = activeRide?.fare ?? 0
  const [realCommission, setRealCommission] = useState<number | null>(null)
  const [realEarning,    setRealEarning]    = useState<number | null>(null)

  // settleRideCompletionPayment (which writes commission_amount) runs async,
  // fired after verifyEndOTP already responded — poll briefly rather than
  // block this screen on it. Falls back to the estimate below if it never lands.
  useEffect(() => {
    if (!activeRide?.id) return
    let cancelled = false
    let attempts = 0
    const poll = async () => {
      attempts += 1
      try {
        const ride = await driverRideApi.getRide(activeRide.id)
        if (cancelled) return
        if (ride.commission_amount != null) {
          setRealCommission(parseFloat(ride.commission_amount))
          setRealEarning(ride.driver_earning != null ? parseFloat(ride.driver_earning) : null)
          return
        }
      } catch { /* keep polling, fall back to estimate on timeout */ }
      if (attempts < 5 && !cancelled) setTimeout(poll, 1200)
    }
    void poll()
    return () => { cancelled = true }
  }, [activeRide?.id])

  const commissionIsEstimate = realCommission === null
  const commission = realCommission ?? Math.round(fare * 0.15)
  const net         = realEarning ?? parseFloat((fare - commission).toFixed(2))
  const isRental    = activeRide?.rideType === 'rental'
  const isRoundTrip = activeRide?.rideType === 'round_trip'
  const isCash      = activeRide?.paymentChannel === 'cash'

  const [riderRating,   setRiderRating]   = useState(0)
  const [hoveredStar,   setHoveredStar]   = useState(0)
  const [riderTags,     setRiderTags]     = useState<RatingTag[]>([])
  const [selectedTags,  setSelectedTags]  = useState<string[]>([])
  const [ratingSubmitting, setRatingSubmitting] = useState(false)
  const [ratingSubmitted,  setRatingSubmitted]  = useState(false)
  const [ratingError,      setRatingError]      = useState(false)
  const [sheetOpen,        setSheetOpen]        = useState(true)
  const displayStar = hoveredStar || riderRating

  useEffect(() => {
    if (confettiFired.current) return
    confettiFired.current = true
    if (sessionId && vehicleId && categoryId) {
      setOnline(sessionId, vehicleId, categoryId)
    }
  }, [sessionId, vehicleId, categoryId, setOnline])

  useEffect(() => {
    void driverSafetyApi.getRiderTags().then(setRiderTags).catch(() => {})
  }, [])

  function toggleTag(id: string) {
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  async function submitRiderRating() {
    if (!riderRating || !activeRide || ratingSubmitting) return
    setRatingSubmitting(true)
    setRatingError(false)
    try {
      await driverSafetyApi.rateRider(activeRide.id, riderRating, selectedTags)
      setRatingSubmitted(true)
      setTimeout(() => setSheetOpen(false), 700)
    } catch {
      setRatingError(true)
    } finally {
      setRatingSubmitting(false)
    }
  }

  function skipRating() {
    setSheetOpen(false)
  }

  const handleBackHome = () => {
    clearRide()
    navigate('/', { replace: true })
  }

  const reduce = useReducedMotion()

  return (
    <div
      className="min-h-[100dvh] bg-bg text-text-primary px-5 flex flex-col"
      style={{
        paddingTop:    'max(env(safe-area-inset-top), 2.5rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)',
      }}
    >
      {/* Hero */}
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 15 }}
        className="flex flex-col items-center mb-6 mt-4"
      >
        <div
          className="w-20 h-20 rounded-full bg-accent-green flex items-center justify-center mb-4"
          style={{ boxShadow: '0 0 40px rgba(34,197,94,0.28)' }}
        >
          <motion.div
            initial={reduce ? { opacity: 0 } : { scale: 0.4, rotate: -25, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={reduce ? { duration: 0.01 } : { type: 'spring', damping: 12, stiffness: 260, delay: 0.15 }}
          >
            <Check size={40} strokeWidth={3} className="text-white" aria-hidden="true" />
          </motion.div>
        </div>
        <h1 className="text-text-primary font-black text-3xl">Trip Complete!</h1>

        {/* Route: compact, truncated to single line */}
        <div className="flex items-center gap-1.5 mt-2 w-full max-w-xs px-1 min-w-0">
          <MapPin size={11} className="text-primary flex-shrink-0" />
          <span className="text-text-secondary text-xs truncate min-w-0">
            {activeRide?.pickup ?? '—'}
          </span>
          {!isRental && (
            <>
              <ArrowRight size={10} className="text-text-muted flex-shrink-0" />
              <span className="text-text-secondary text-xs truncate min-w-0">
                {activeRide?.drop ?? '—'}
              </span>
            </>
          )}
          {isRental && (
            <span className="text-text-secondary text-xs truncate min-w-0">Flexible route</span>
          )}
        </div>

        {isRoundTrip && activeRide.returnAt && (
          <div className="flex items-center gap-1.5 mt-2">
            <RotateCcw size={11} style={{ color: '#D97706' }} />
            <span className="text-xs font-semibold" style={{ color: '#D97706' }}>
              Return by {fmtReturn(activeRide.returnAt)}
            </span>
          </div>
        )}
        {isRental && activeRide.tripHours != null && (
          <div className="flex items-center gap-1.5 mt-2">
            <Clock size={11} style={{ color: '#6D28D9' }} />
            <span className="text-xs font-semibold" style={{ color: '#6D28D9' }}>
              Rental · {activeRide.tripHours}h booked
            </span>
          </div>
        )}
      </motion.div>

      {/* Earnings card */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="bg-surface rounded-3xl border border-border p-5 mb-4"
        style={{ boxShadow: '0 4px 24px rgba(34,197,94,0.14)' }}
      >
        <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2">
          {isCash ? 'Cash Collected' : 'You Earned'}
        </p>
        <p className="text-[44px] font-black text-primary leading-none mb-4">₹{fmt(isCash ? fare : net)}</p>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Ride fare</span>
            <span className="text-text-primary font-semibold">₹{fmt(fare)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">
              {isCash
                ? `Commission (deducted from wallet${commissionIsEstimate ? ', est.' : ''})`
                : `Platform commission${commissionIsEstimate ? ' (est.)' : ''}`}
            </span>
            <span className="text-accent-red font-semibold">-₹{commission}</span>
          </div>
          <div className="border-t border-border pt-2 flex justify-between text-sm">
            <span className="text-text-primary font-bold">{isCash ? 'You keep' : 'Net earnings'}</span>
            <span className="text-primary font-black">₹{fmt(isCash ? fare : net)}</span>
          </div>
        </div>
        {isCash && (
          <p className="text-text-muted text-xs mt-3 pt-2 border-t border-border">
            You collected this fare in cash. Commission has already been deducted from your wallet — no payout is due for this ride.
          </p>
        )}
      </motion.div>

      {/* Stats row */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="bg-surface rounded-3xl border border-border p-5 mb-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center">
            <p className="text-text-primary font-black text-xl">₹{fmt(fare)}</p>
            <p className="text-text-muted text-xs mt-0.5">Fare</p>
          </div>
          <div className="text-center border-l border-border">
            <div className="flex items-center justify-center gap-1">
              <Star size={14} className="text-accent-amber fill-accent-amber" />
              <p className="text-text-primary font-black text-xl">
                {driver?.rating ? Number(driver.rating).toFixed(1) : '—'}
              </p>
            </div>
            <p className="text-text-muted text-xs mt-0.5">Your rating</p>
          </div>
        </div>
      </motion.div>

      <div className="flex-1" />

      <motion.button
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        onClick={handleBackHome}
        className="btn-go w-full flex items-center justify-center gap-2 active:scale-95 transition-transform"
        style={{ minHeight: 56 }}
      >
        Back to Home <ArrowRight size={18} />
      </motion.button>

      <AnimatePresence>
        {sheetOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={skipRating}
              className="fixed inset-0 bg-black/50 z-40"
            />
            <motion.div
              key="sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed left-0 right-0 bottom-0 z-50 bg-surface rounded-t-3xl border-t border-border p-5"
              style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.25rem)' }}
            >
              <div className="w-10 h-1.5 rounded-full bg-border mx-auto mb-4" />

              {ratingSubmitted ? (
                <div className="flex items-center gap-2 justify-center py-4">
                  <Check size={16} className="text-primary" aria-hidden="true" />
                  <span className="text-text-primary font-semibold text-sm">Thanks for rating your rider</span>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between mb-1">
                    <p className="text-text-primary font-bold text-base">
                      Rate {activeRide?.userName ?? 'your rider'}
                    </p>
                    <button type="button" aria-label="Skip rating" onClick={skipRating}>
                      <X size={20} className="text-text-muted" />
                    </button>
                  </div>

                  <div className="flex justify-center gap-2 my-4">
                    {[1, 2, 3, 4, 5].map(star => (
                      <button
                        key={star}
                        type="button"
                        aria-label={`${star} star${star > 1 ? 's' : ''}`}
                        onClick={() => setRiderRating(star)}
                        onMouseEnter={() => setHoveredStar(star)}
                        onMouseLeave={() => setHoveredStar(0)}
                      >
                        <motion.div animate={{ scale: displayStar >= star ? 1.15 : 1 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}>
                          <Star
                            size={34}
                            className={displayStar >= star ? 'text-accent-amber fill-accent-amber' : 'text-border fill-border'}
                          />
                        </motion.div>
                      </button>
                    ))}
                  </div>

                  {riderRating > 0 && riderTags.length > 0 && (
                    <div className="flex flex-wrap gap-2 justify-center mb-2">
                      {riderTags
                        .filter(t => riderRating >= 4 ? t.sentiment === 'positive' : riderRating <= 2 ? t.sentiment === 'negative' : true)
                        .map(tag => (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => toggleTag(tag.id)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                              selectedTags.includes(tag.id)
                                ? 'bg-primary border-primary text-white'
                                : 'bg-bg border-border text-text-secondary'
                            }`}
                          >
                            {tag.label}
                          </button>
                        ))}
                    </div>
                  )}

                  {riderRating > 0 && (
                    <button
                      type="button"
                      onClick={() => void submitRiderRating()}
                      disabled={ratingSubmitting}
                      className="w-full mt-3 py-3 rounded-2xl bg-primary text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-60"
                    >
                      {ratingSubmitting ? 'Submitting…' : 'Submit rating'}
                    </button>
                  )}
                  {ratingError && (
                    <p className="text-status-error text-xs text-center mt-2">Could not submit, try again.</p>
                  )}
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
