'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Star } from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import { useParams, useRouter } from 'next/navigation'
import { rideApi } from '@/lib/ride-api'
import { safetyApi, type RatingTag } from '@/lib/safety-api'
import { cn } from '@/lib/utils'

export default function RateRidePage() {
  const params = useParams<{ id: string }>()
  const rideId = params?.id ?? ''
  const router  = useRouter()

  const [driverName,    setDriverName]    = useState<string | null>(null)
  const [driverId,      setDriverId]      = useState<string | null>(null)
  const [tags,          setTags]          = useState<RatingTag[]>([])
  const [rating,        setRating]        = useState(0)
  const [hovered,       setHovered]       = useState(0)
  const [selectedTags,  setSelectedTags]  = useState<string[]>([])
  const [submitting,    setSubmitting]    = useState(false)
  const [submitted,     setSubmitted]     = useState(false)
  const [alreadyRated,  setAlreadyRated]  = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  useEffect(() => {
    if (!rideId) return
    void rideApi.getRide(rideId).then(ride => {
      setDriverName(ride.driver_name)
      setDriverId(ride.driver_id)
      if (ride.user_rating_given != null) setAlreadyRated(true)
    }).catch(() => {})

    void safetyApi.getTags('user_to_driver').then(setTags).catch(() => {})
  }, [rideId])

  const displayRating = hovered || rating

  function toggleTag(id: string) {
    setSelectedTags(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    )
  }

  async function handleSubmit() {
    if (!rating || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await safetyApi.submitRating({
        rideId,
        direction:   'user_to_driver',
        score:       rating,
        toDriverId:  driverId ?? undefined,
        tagIds:      selectedTags,
      })
      setSubmitted(true)
      setTimeout(() => router.replace('/home'), 1200)
    } catch {
      setError('Could not submit rating. Please try again.')
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="h-full bg-background flex flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 15 }}
          className="text-6xl mb-4"
        >
          🎉
        </motion.div>
        <h2 className="text-xl font-bold text-text-primary mb-2">Thanks for rating!</h2>
        <p className="text-text-muted text-sm">Your feedback helps drivers improve</p>
        <div className="mt-6"><OcarSpinner size={24} variant="color" /></div>
      </div>
    )
  }

  if (alreadyRated) {
    return (
      <div className="h-full bg-background flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary-subtle flex items-center justify-center text-3xl mb-4">
          ⭐
        </div>
        <h2 className="text-xl font-bold text-text-primary mb-2">You already rated this trip</h2>
        <p className="text-text-muted text-sm mb-6">Thanks for your feedback on this ride.</p>
        <button
          onClick={() => router.replace(`/ride/${rideId}/receipt`)}
          className="btn-primary"
        >
          Back to trip details
        </button>
      </div>
    )
  }

  return (
    <div className="h-full bg-background flex flex-col px-6 pb-8 overflow-y-auto">
      <div className="pt-12 pb-6 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary-subtle flex items-center justify-center text-3xl mb-4">
          👤
        </div>
        <h1 className="text-xl font-bold text-text-primary mb-1">How was your ride?</h1>
        <p className="text-text-muted text-sm">{driverName ?? 'Your Driver'}</p>
      </div>

      {/* Stars */}
      <div className="flex justify-center gap-3 mb-8">
        {[1, 2, 3, 4, 5].map(star => (
          <button
            key={star}
            onClick={() => setRating(star)}
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
          >
            <motion.div
              animate={{ scale: displayRating >= star ? 1.2 : 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 15 }}
            >
              <Star
                size={36}
                className={cn(
                  'transition-colors',
                  displayRating >= star
                    ? 'fill-status-warning text-status-warning'
                    : 'fill-border text-border'
                )}
              />
            </motion.div>
          </button>
        ))}
      </div>

      {/* Tags, shown for all ratings, positive tags for ≥4, negative for ≤2 */}
      {rating > 0 && tags.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6"
        >
          <p className="text-sm font-semibold text-text-primary mb-3">
            {rating >= 4 ? 'What did you love?' : rating <= 2 ? 'What went wrong?' : 'Tell us more'}
          </p>
          <div className="flex flex-wrap gap-2">
            {tags
              .filter(t => {
                if (rating >= 4) return t.sentiment === 'positive'
                if (rating <= 2) return t.sentiment === 'negative'
                return true
              })
              .map(tag => (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className={cn(
                    'px-3.5 py-2 rounded-full text-sm font-medium border transition-colors',
                    selectedTags.includes(tag.id)
                      ? 'bg-primary border-primary text-white'
                      : 'bg-surface border-border text-text-secondary'
                  )}
                >
                  {tag.label}
                </button>
              ))}
          </div>
        </motion.div>
      )}

      {error && (
        <p className="text-sm text-status-error text-center mb-4">{error}</p>
      )}

      <div className="mt-auto space-y-3">
        <button
          onClick={() => void handleSubmit()}
          disabled={!rating || submitting}
          className="btn-primary w-full"
        >
          {submitting ? 'Submitting…' : 'Submit Rating'}
        </button>
        <button
          onClick={() => router.replace('/home')}
          className="w-full text-center text-text-muted text-sm"
        >
          Skip
        </button>
      </div>
    </div>
  )
}
