import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Banknote, X } from 'lucide-react'
import { useRideStore } from '@/store/useRideStore'
import { driverRideApi } from '@/lib/ride-api'
import SwipeToConfirm from '@/components/ui/SwipeToConfirm'

function fmt(n: number) {
  const s = n.toFixed(2)
  return s.endsWith('.00') ? s.slice(0, -3) : s
}

const DEVIATION_CONFIRM_THRESHOLD = 0.2 // 20% off the quoted fare needs a second tap

export default function CollectCash() {
  const navigate = useNavigate()
  const { activeRide } = useRideStore()
  const fare = activeRide?.fare ?? 0

  const [sheetOpen, setSheetOpen] = useState(false)
  const [customAmount, setCustomAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState(false)

  async function submit(body: { collectedAmount?: number; notCollected?: boolean }) {
    if (!activeRide || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await driverRideApi.collectCash(activeRide.id, body)
      navigate('/ride/end', { replace: true })
    } catch {
      setError('Could not save this. Check your connection and try again.')
      setSubmitting(false)
    }
  }

  function confirmCustomAmount() {
    const parsed = parseFloat(customAmount)
    if (!Number.isFinite(parsed) || parsed < 0) return
    const deviates = fare > 0 && Math.abs(parsed - fare) / fare > DEVIATION_CONFIRM_THRESHOLD
    if (deviates && !pendingConfirm) {
      setPendingConfirm(true)
      return
    }
    void submit({ collectedAmount: parsed })
  }

  return (
    <div
      className="min-h-[100dvh] bg-bg text-text-primary px-5 flex flex-col"
      style={{
        paddingTop:    'max(env(safe-area-inset-top), 2.5rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)',
      }}
    >
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 15 }}
        className="flex-1 flex flex-col items-center justify-center"
      >
        <div
          className="w-20 h-20 rounded-full bg-accent-green flex items-center justify-center mb-5"
          style={{ boxShadow: '0 0 40px rgba(34,197,94,0.28)' }}
        >
          <Banknote size={36} className="text-white" aria-hidden="true" />
        </div>

        <p className="text-text-secondary text-sm font-semibold mb-2">Collect cash from rider</p>
        <p className="text-[56px] font-black text-text-primary leading-none mb-2">₹{fmt(fare)}</p>
        <p className="text-text-muted text-xs">
          Cash{activeRide?.userName ? ` · ${activeRide.userName}` : ''}
        </p>
      </motion.div>

      {error && (
        <p className="text-status-error text-xs text-center mb-3">{error}</p>
      )}

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="mb-3"
      >
        <SwipeToConfirm
          label={`Slide — collected ₹${fmt(fare)}`}
          onConfirm={() => void submit({ collectedAmount: fare })}
          disabled={submitting}
          color="#16A34A"
        />
      </motion.div>

      <button
        type="button"
        onClick={() => { setSheetOpen(true); setPendingConfirm(false) }}
        disabled={submitting}
        className="text-text-muted text-xs font-semibold text-center py-2 disabled:opacity-60"
      >
        Different amount / not collected
      </button>

      <AnimatePresence>
        {sheetOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !submitting && setSheetOpen(false)}
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

              <div className="flex items-start justify-between mb-4">
                <p className="text-text-primary font-bold text-base">Adjust cash collected</p>
                <button type="button" aria-label="Close" onClick={() => setSheetOpen(false)} disabled={submitting}>
                  <X size={20} className="text-text-muted" />
                </button>
              </div>

              <label className="text-text-secondary text-xs font-semibold mb-1.5 block">
                Amount actually collected (₹)
              </label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={customAmount}
                onChange={(e) => { setCustomAmount(e.target.value); setPendingConfirm(false) }}
                placeholder={fmt(fare)}
                className="w-full rounded-2xl border border-border bg-bg px-4 py-3 text-text-primary text-lg font-bold mb-3 focus:outline-none focus:ring-2 focus:ring-primary"
              />

              {pendingConfirm && (
                <p className="text-status-error text-xs text-center mb-2">
                  That's well off the ₹{fmt(fare)} fare — tap again to confirm ₹{customAmount}.
                </p>
              )}
              <button
                type="button"
                onClick={confirmCustomAmount}
                disabled={submitting || customAmount === ''}
                className="w-full py-3 rounded-2xl bg-primary text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-60 mb-3"
              >
                {submitting
                  ? 'Saving…'
                  : pendingConfirm
                  ? `Yes, confirm ₹${customAmount || '0'}`
                  : `Confirm ₹${customAmount || '0'} collected`}
              </button>

              <button
                type="button"
                onClick={() => void submit({ notCollected: true })}
                disabled={submitting}
                className="w-full py-3 rounded-2xl border border-accent-red text-accent-red text-sm font-semibold active:scale-95 transition-transform disabled:opacity-60"
              >
                Cash not collected
              </button>

              {error && (
                <p className="text-status-error text-xs text-center mt-3">{error}</p>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
