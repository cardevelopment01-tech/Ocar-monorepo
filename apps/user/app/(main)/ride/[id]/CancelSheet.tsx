'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, AlertCircle } from 'lucide-react'
import { SHEET_SPRING } from '@/lib/motion'

const BEFORE_REASONS = [
  { code: 'changed_mind',       label: 'Changed my mind' },
  { code: 'booked_by_mistake',  label: 'Booked by mistake' },
  { code: 'found_another_ride', label: 'Found another ride' },
  { code: 'emergency',          label: 'Emergency' },
]

const AFTER_REASONS = [
  { code: 'driver_too_far',        label: 'Driver is too far away' },
  { code: 'driver_not_responding', label: 'Driver not responding' },
  { code: 'driver_behavior',       label: 'Driver behavior issue' },
  { code: 'emergency',             label: 'Emergency' },
  { code: 'other',                 label: 'Other reason' },
]

type Props = {
  feeWarning: boolean
  onConfirm: (reasonCode: string, reason?: string) => Promise<void>
  onClose: () => void
}

export default function CancelSheet({ feeWarning, onConfirm, onClose }: Props) {
  const [selected, setSelected]     = useState<string | null>(null)
  const [otherText, setOtherText]   = useState('')
  const [submitting, setSubmitting] = useState(false)

  const reasons   = feeWarning ? AFTER_REASONS : BEFORE_REASONS
  const canSubmit = selected !== null && (selected !== 'other' || otherText.trim().length > 0)

  const handleConfirm = async () => {
    if (!selected || submitting) return
    setSubmitting(true)
    await onConfirm(selected, selected === 'other' ? otherText.trim() : undefined)
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={() => { if (!submitting) onClose() }}
      />

      {/* Sheet */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        transition={SHEET_SPRING}
        className="relative w-full bg-white rounded-t-[28px] px-5 pt-5 shadow-[0_-8px_40px_rgba(0,0,0,0.14)]"
        style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
      >
        {/* Handle */}
        <div className="flex justify-center mb-4">
          <div className="w-9 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[17px] font-black text-gray-900">Cancel your ride?</h2>
          <button
            onClick={onClose}
            disabled={submitting}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 active:scale-95 transition-transform disabled:opacity-50"
          >
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Fee warning */}
        {feeWarning && (
          <div
            className="flex items-start gap-2.5 px-3.5 py-3 rounded-2xl mb-4"
            style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.30)' }}
          >
            <AlertCircle size={15} className="text-yellow-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-yellow-800 font-medium leading-snug">
              A small cancellation fee may apply since your driver has already accepted.
            </p>
          </div>
        )}

        {/* Reason list */}
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2.5">
          Why are you cancelling?
        </p>
        <div className="space-y-2 mb-5">
          {reasons.map(r => (
            <button
              key={r.code}
              onClick={() => setSelected(r.code)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all active:scale-[0.98]"
              style={selected === r.code
                ? { background: 'rgba(220,38,38,0.07)', border: '1.5px solid rgba(220,38,38,0.40)' }
                : { background: '#F8FAFC', border: '1.5px solid #E2E8F0' }
              }
            >
              <div
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={selected === r.code
                  ? { border: '5px solid #DC2626' }
                  : { border: '2px solid #CBD5E1' }
                }
              />
              <span className={`text-sm font-medium ${selected === r.code ? 'text-red-700' : 'text-gray-700'}`}>
                {r.label}
              </span>
            </button>
          ))}
        </div>

        {/* Other text input */}
        <AnimatePresence>
          {selected === 'other' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mb-4"
            >
              <textarea
                value={otherText}
                onChange={e => setOtherText(e.target.value)}
                placeholder="Tell us more…"
                rows={3}
                maxLength={200}
                autoFocus
                className="w-full px-4 py-3 rounded-2xl text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none"
                style={{ background: '#F8FAFC', border: '1.5px solid #E2E8F0' }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Actions */}
        <button
          onClick={handleConfirm}
          disabled={!canSubmit || submitting}
          className="w-full py-3.5 rounded-2xl text-sm font-bold text-white mb-2.5 transition-all disabled:opacity-40 active:scale-[0.98]"
          style={{ background: '#DC2626' }}
        >
          {submitting ? 'Cancelling…' : 'Confirm cancellation'}
        </button>
        <button
          onClick={onClose}
          disabled={submitting}
          className="w-full py-3 rounded-2xl text-sm font-semibold text-gray-700 transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: '#F1F5F9', border: '1px solid #E2E8F0' }}
        >
          Keep my ride
        </button>
      </motion.div>
    </div>
  )
}
