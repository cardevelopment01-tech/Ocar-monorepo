'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Star } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { mockDriver } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

const TAGS = ['Great driver', 'Clean vehicle', 'On time', 'Safe driving', 'Friendly', 'Smooth ride']

export default function RateRidePage() {
  const router = useRouter()
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tip, setTip] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const displayRating = hovered || rating

  const TIPS = [0, 10, 20, 50]

  function toggleTag(tag: string) {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    )
  }

  async function handleSubmit() {
    setSubmitted(true)
    await new Promise(r => setTimeout(r, 1200))
    router.push('/home')
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
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
        <div className="mt-6 w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex flex-col px-6 pb-safe-bottom">
      <div className="pt-12 pb-6 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary-subtle flex items-center justify-center text-3xl mb-4">
          👤
        </div>
        <h1 className="text-xl font-bold text-text-primary mb-1">How was your ride?</h1>
        <p className="text-text-muted text-sm">{mockDriver.name} · {mockDriver.vehicle}</p>
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

      {/* Tags */}
      {rating >= 4 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6"
        >
          <p className="text-sm font-semibold text-text-primary mb-3">What did you love?</p>
          <div className="flex flex-wrap gap-2">
            {TAGS.map(tag => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={cn(
                  'px-3.5 py-2 rounded-full text-sm font-medium border transition-colors',
                  selectedTags.includes(tag)
                    ? 'bg-primary border-primary text-white'
                    : 'bg-surface border-border text-text-secondary'
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Tip */}
      <div className="mb-8">
        <p className="text-sm font-semibold text-text-primary mb-3">Add a tip</p>
        <div className="flex gap-2">
          {TIPS.map(amt => (
            <button
              key={amt}
              onClick={() => setTip(tip === amt ? null : amt)}
              className={cn(
                'flex-1 py-2.5 rounded-2xl border text-sm font-semibold transition-colors',
                tip === amt
                  ? 'bg-primary border-primary text-white'
                  : 'bg-surface border-border text-text-secondary'
              )}
            >
              {amt === 0 ? 'None' : `₹${amt}`}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto">
        <button
          onClick={handleSubmit}
          disabled={!rating}
          className="btn-primary w-full"
        >
          Submit Rating
        </button>
        <button
          onClick={() => router.push('/home')}
          className="w-full text-center text-text-muted text-sm mt-4"
        >
          Skip
        </button>
      </div>
    </div>
  )
}
