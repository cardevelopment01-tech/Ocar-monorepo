'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

interface Props {
  changeCount: number
  invalidCount: number
  saving: boolean
  onDiscard: () => void
  onReview: () => void
}

/**
 * Floats above the page only while there is something unsaved. `sticky`, not `fixed`: the
 * dashboard wrapper's animate-fade-in (forwards) leaves a transform on it, which would make a
 * `fixed` child position against the page instead of the viewport. Sticky also centres on the
 * content column for free (no sidebar offset).
 */
export default function SaveBar({ changeCount, invalidCount, saving, onDiscard, onReview }: Props) {
  const reduce = useReducedMotion()
  const canReview = changeCount > 0 && invalidCount === 0 && !saving

  return (
    <AnimatePresence>
      {changeCount > 0 && (
        <motion.div
          key="save-bar"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-none sticky bottom-5 z-40 mt-8 flex justify-center"
        >
          <div
            role="region"
            aria-label="Unsaved changes"
            className="pointer-events-auto flex w-full max-w-[640px] flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-2xl border border-border bg-surface px-5 py-3"
            style={{ boxShadow: '0 8px 32px rgba(79,70,229,0.16), 0 1px 3px rgba(15,23,42,0.06)' }}
          >
            <p className="text-md font-semibold text-text-primary" aria-live="polite">
              {changeCount} unsaved {changeCount === 1 ? 'change' : 'changes'}
              {invalidCount > 0 && (
                <span className="ml-2 font-medium text-red-700">
                  · {invalidCount} to fix
                </span>
              )}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onDiscard}
                disabled={saving}
                className="min-h-[44px] rounded-xl border border-border px-4 text-md font-semibold text-text-secondary transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:transition-none"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={onReview}
                disabled={!canReview}
                className="min-h-[44px] rounded-xl bg-primary px-5 text-md font-semibold text-white transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 motion-reduce:transition-none"
              >
                Review &amp; save
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
